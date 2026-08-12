import { randomBytes, randomInt } from 'node:crypto';
import type { Effect, Phase, RoomStateView, Rules } from '@uno/shared';
import { CLASSIC_RULES, sanitizeRules } from '@uno/shared';
import {
  applyAction, createGame, removeFromRound, type Action, type GameState,
} from './engine/game.js';
import { rng } from './engine/deck.js';
import { projectView } from './engine/views.js';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
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
}

const norm = (code: string) => code.toUpperCase().replaceAll('-', '');

/** Omit that distributes over a discriminated union, so each Action variant
 *  keeps its own payload fields (plain Omit collapses them to just `type`). */
type SeatlessAction = Action extends infer A ? (A extends Action ? Omit<A, 'seat'> : never) : never;

export class RoomStore {
  private rooms = new Map<string, Room>();
  constructor(private now: () => number = Date.now) {}

  createRoom(opts: { seed?: number } = {}): Room {
    let key: string;
    do {
      key = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    } while (this.rooms.has(key));
    const room: Room = {
      code: `${key.slice(0, 4)}-${key.slice(4)}`,
      createdAtMs: this.now(), emptySinceMs: this.now(),
      phase: 'lobby', players: [], hostSeat: 0,
      game: null, winTally: [],
      seed: opts.seed ?? randomInt(2 ** 31),
      rules: { ...CLASSIC_RULES },
    };
    this.rooms.set(key, room);
    return room;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(norm(code));
  }

  join(code: string, name: string) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: 'table not found' };
    if (room.phase !== 'lobby') return { ok: false as const, error: 'game already started' };
    if (room.players.length >= MAX_SEATS) return { ok: false as const, error: 'table is full' };
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
    if (!room) return { ok: false as const, error: 'table not found' };
    const seat = room.players.findIndex((p) => p.token === token && !p.left);
    if (seat === -1) return { ok: false as const, error: 'seat not found' };
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
    if (!room) return { ok: false as const, error: 'table not found' };
    if (this.seatFor(room, token) !== room.hostSeat) {
      return { ok: false as const, error: 'only the host sets the rules' };
    }
    if (room.phase !== 'lobby') return { ok: false as const, error: 'rules lock once the game starts' };
    room.rules = sanitizeRules(rules);
    return { ok: true as const };
  }

  startGame(code: string, token: string) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: 'table not found' };
    const seat = this.seatFor(room, token);
    if (seat !== room.hostSeat) return { ok: false as const, error: 'only the host can deal' };
    if (room.phase !== 'lobby') return { ok: false as const, error: 'already dealt' };
    if (room.players.length < 2) return { ok: false as const, error: 'need at least two players' };
    room.game = createGame(room.players.length, rng(room.seed), room.rules);
    room.phase = 'playing';
    return { ok: true as const };
  }

  act(code: string, token: string, action: SeatlessAction) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: 'table not found' };
    if (room.phase !== 'playing' || !room.game) return { ok: false as const, error: 'no round in progress' };
    const seat = this.seatFor(room, token);
    if (seat === -1) return { ok: false as const, error: 'seat not found' };
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
    if (!room) return { ok: false as const, error: 'table not found' };
    if (room.phase !== 'roundEnd') return { ok: false as const, error: 'round still running' };
    if (this.seatFor(room, token) === -1) return { ok: false as const, error: 'seat not found' };
    // Compact away players who left; keep everyone else's seat order and tally.
    const stayingIdx = room.players.flatMap((p, i) => (p.left ? [] : [i]));
    room.players = stayingIdx.map((i) => room.players[i]!);
    room.winTally = stayingIdx.map((i) => room.winTally[i]!);
    room.hostSeat = 0;
    if (room.players.length < 2) return { ok: false as const, error: 'not enough players' };
    room.seed = randomInt(2 ** 31);
    room.game = createGame(room.players.length, rng(room.seed), room.rules);
    room.phase = 'playing';
    return { ok: true as const };
  }

  continueWithout(code: string, token: string, targetSeat: number) {
    const room = this.getRoom(code);
    if (!room || !room.game) return { ok: false as const, error: 'table not found' };
    if (this.seatFor(room, token) === -1) return { ok: false as const, error: 'seat not found' };
    const target = room.players[targetSeat];
    if (!target || target.left) return { ok: false as const, error: 'no such seat' };
    if (target.connected) return { ok: false as const, error: 'player is connected' };
    if (target.disconnectedAtMs === null || this.now() - target.disconnectedAtMs < CONTINUE_GRACE_MS) {
      return { ok: false as const, error: 'grace period still running' };
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
      game: room.game,
    }, seat);
  }

  sweep(): void {
    for (const [key, room] of this.rooms) {
      const age = this.now() - room.createdAtMs;
      const emptyFor = room.emptySinceMs === null ? 0 : this.now() - room.emptySinceMs;
      if (age > MAX_AGE_MS || emptyFor > EMPTY_TTL_MS) this.rooms.delete(key);
    }
  }
}
