import { randomBytes, randomInt } from 'node:crypto';
import type { Effect, Phase, RoomStateView, Rules } from '@uno/shared';
import { CLASSIC_RULES, sanitizeRules } from '@uno/shared';
import {
  applyAction, createGame, removeFromRound, type Action, type GameState,
} from './engine/game.js';
import { rng } from './engine/deck.js';
import { projectView } from './engine/views.js';

// No look-alikes (0/O/Q, 1/I/L, 5/S, 8/B, 2/Z) or sound-alikes (U/V, G/J).
const ALPHABET = '34679ACDEFHKMNPRTWXY';
const CODE_LEN = 5;
export const CONTINUE_GRACE_MS = 120_000;
const EMPTY_TTL_MS = 10 * 60_000;
const MAX_AGE_MS = 24 * 60 * 60_000;
const MAX_SEATS = 4;

export interface RoomPlayer {
  name: string; token: string;
  socketId: string | null; connected: boolean;
  disconnectedAtMs: number | null; left: boolean;
}

export interface Room {
  code: string;
  createdAtMs: number; emptySinceMs: number | null;
  phase: Phase; players: RoomPlayer[]; hostSeat: number;
  game: GameState | null; winTally: number[]; seed: number;
  rules: Rules;
  pin: string | null; // ephemeral room secret, plain text by design (rate limits guard it)
}

const norm = (code: string) => code.toUpperCase().replace(/[\s-]/g, '');

/** Omit that distributes over a discriminated union, so each Action variant
 *  keeps its own payload fields (plain Omit collapses them to just `type`). */
type SeatlessAction = Action extends infer A ? (A extends Action ? Omit<A, 'seat'> : never) : never;

export class RoomStore {
  private rooms = new Map<string, Room>();
  constructor(private now: () => number = Date.now) {}

  createRoom(opts: { seed?: number; rules?: Partial<Rules>; pin?: string | null } = {}): Room {
    let key: string;
    do {
      key = Array.from({ length: CODE_LEN }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    } while (this.rooms.has(key));
    const room: Room = {
      code: key,
      createdAtMs: this.now(), emptySinceMs: this.now(),
      phase: 'lobby', players: [], hostSeat: 0,
      game: null, winTally: [],
      seed: opts.seed ?? randomInt(2 ** 31),
      rules: sanitizeRules(opts.rules),
      pin: opts.pin ?? null,
    };
    this.rooms.set(key, room);
    return room;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(norm(code));
  }

  join(code: string, name: string, pin?: string) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: 'table_not_found' };
    if (room.phase !== 'lobby') return { ok: false as const, error: 'game_started' };
    if (room.players.length >= MAX_SEATS) return { ok: false as const, error: 'table_full' };
    if (room.pin !== null && pin !== room.pin) {
      return { ok: false as const, error: pin === undefined ? 'pin_required' : 'wrong_pin' };
    }
    const token = randomBytes(16).toString('hex');
    room.players.push({
      name: name.trim().slice(0, 24) || 'Player',
      token, socketId: null, connected: false, disconnectedAtMs: null, left: false,
    });
    room.winTally.push(0);
    return { ok: true as const, seat: room.players.length - 1, token };
  }

  resume(code: string, token: string) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: 'table_not_found' };
    const seat = room.players.findIndex((p) => p.token === token && !p.left);
    if (seat === -1) return { ok: false as const, error: 'seat_not_found' };
    return { ok: true as const, seat };
  }

  setConnection(code: string, seat: number, socketId: string | null): void {
    const room = this.getRoom(code);
    const player = room?.players[seat];
    if (!room || !player) return;
    player.socketId = socketId;
    player.connected = socketId !== null;
    player.disconnectedAtMs = socketId === null ? this.now() : null;
    room.emptySinceMs = room.players.some((p) => p.connected && !p.left) ? null : this.now();
  }

  private seatFor(room: Room, token: string): number {
    return room.players.findIndex((p) => p.token === token && !p.left);
  }

  setRules(code: string, token: string, rules: Rules) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: 'table_not_found' };
    if (this.seatFor(room, token) !== room.hostSeat) {
      return { ok: false as const, error: 'host_only_rules' };
    }
    if (room.phase !== 'lobby') return { ok: false as const, error: 'rules_locked' };
    room.rules = sanitizeRules(rules);
    return { ok: true as const };
  }

  setPin(code: string, token: string, pin: string | null) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: 'table_not_found' };
    if (this.seatFor(room, token) !== room.hostSeat) {
      return { ok: false as const, error: 'host_only_rules' };
    }
    if (room.phase !== 'lobby') return { ok: false as const, error: 'rules_locked' };
    if (pin !== null && !/^\d{4}$/.test(pin)) return { ok: false as const, error: 'bad_pin' };
    room.pin = pin;
    return { ok: true as const };
  }

  startGame(code: string, token: string) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: 'table_not_found' };
    const seat = this.seatFor(room, token);
    if (seat !== room.hostSeat) return { ok: false as const, error: 'host_only_deal' };
    if (room.phase !== 'lobby') return { ok: false as const, error: 'already_dealt' };
    if (room.players.length < 2) return { ok: false as const, error: 'need_two_players' };
    room.game = createGame(room.players.length, rng(room.seed), room.rules);
    room.phase = 'playing';
    return { ok: true as const };
  }

  act(code: string, token: string, action: SeatlessAction) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: 'table_not_found' };
    if (room.phase !== 'playing' || !room.game) return { ok: false as const, error: 'no_round' };
    const seat = this.seatFor(room, token);
    if (seat === -1) return { ok: false as const, error: 'seat_not_found' };
    const result = applyAction(room.game, { ...action, seat } as Action);
    if (!result.ok) return result;
    room.game = result.state;
    if (result.state.winner !== null) {
      room.phase = 'roundEnd';
      room.winTally[result.state.winner] = (room.winTally[result.state.winner] ?? 0) + 1;
    }
    return { ok: true as const, effects: result.effects };
  }

  rematch(code: string, token: string) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: 'table_not_found' };
    if (room.phase !== 'roundEnd') return { ok: false as const, error: 'round_running' };
    if (this.seatFor(room, token) === -1) return { ok: false as const, error: 'seat_not_found' };
    // Compact away players who left; keep everyone else's seat order and tally.
    const stayingIdx = room.players.flatMap((p, i) => (p.left ? [] : [i]));
    room.players = stayingIdx.map((i) => room.players[i]!);
    room.winTally = stayingIdx.map((i) => room.winTally[i]!);
    room.hostSeat = 0;
    if (room.players.length < 2) return { ok: false as const, error: 'not_enough_players' };
    room.seed = randomInt(2 ** 31);
    room.game = createGame(room.players.length, rng(room.seed), room.rules);
    room.phase = 'playing';
    return { ok: true as const };
  }

  continueWithout(code: string, token: string, targetSeat: number) {
    const room = this.getRoom(code);
    if (!room || !room.game) return { ok: false as const, error: 'table_not_found' };
    if (this.seatFor(room, token) === -1) return { ok: false as const, error: 'seat_not_found' };
    const target = room.players[targetSeat];
    if (!target || target.left) return { ok: false as const, error: 'no_such_seat' };
    if (target.connected) return { ok: false as const, error: 'player_connected' };
    if (target.disconnectedAtMs === null || this.now() - target.disconnectedAtMs < CONTINUE_GRACE_MS) {
      return { ok: false as const, error: 'grace_running' };
    }
    target.left = true;
    room.game = removeFromRound(room.game, targetSeat);
    if (room.game.winner !== null) {
      room.phase = 'roundEnd';
      room.winTally[room.game.winner] = (room.winTally[room.game.winner] ?? 0) + 1;
    }
    return { ok: true as const };
  }

  pausedForSeat(room: Room): number | null {
    if (room.phase !== 'playing') return null;
    const seat = room.players.findIndex((p) => !p.left && !p.connected);
    return seat === -1 ? null : seat;
  }

  viewFor(code: string, seat: number): RoomStateView {
    const room = this.getRoom(code)!;
    const pausedSeat = this.pausedForSeat(room);
    return projectView({
      roomCode: room.code, phase: room.phase,
      names: room.players.map((p) => p.name),
      hostSeat: room.hostSeat,
      connected: room.players.map((p) => p.connected),
      winTally: room.winTally,
      pausedForSeat: pausedSeat,
      pausedSinceMs: pausedSeat !== null ? room.players[pausedSeat]!.disconnectedAtMs : null,
      rules: room.rules,
      hasPin: room.pin !== null,
      pin: seat === room.hostSeat ? room.pin : null,
      game: room.game,
    }, seat);
  }

  stats() {
    let lobby = 0, playing = 0, roundEnd = 0, seated = 0, connected = 0;
    for (const room of this.rooms.values()) {
      if (room.phase === 'lobby') lobby += 1;
      else if (room.phase === 'playing') playing += 1;
      else roundEnd += 1;
      for (const p of room.players) {
        if (p.left) continue;
        seated += 1;
        if (p.connected) connected += 1;
      }
    }
    return { rooms: this.rooms.size, lobby, playing, roundEnd, seated, connected };
  }

  /** onRemoved lets callers release per-room state held elsewhere
   *  (e.g. Analytics drops the deal timestamp of a room swept mid-round). */
  sweep(onRemoved?: (code: string) => void): void {
    for (const [key, room] of this.rooms) {
      const age = this.now() - room.createdAtMs;
      const emptyFor = room.emptySinceMs === null ? 0 : this.now() - room.emptySinceMs;
      if (age > MAX_AGE_MS || emptyFor > EMPTY_TTL_MS) {
        this.rooms.delete(key);
        onRemoved?.(key);
      }
    }
  }
}
