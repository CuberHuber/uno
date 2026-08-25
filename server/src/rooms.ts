import { randomBytes, randomInt } from 'node:crypto';
import type { Effect, Phase, RoomStateView, Rules } from '@uno/shared';
import { CLASSIC_RULES, sanitizeRules } from '@uno/shared';
import {
  applyAction, createGame, removeFromRound, type Action, type GameState,
} from './engine/game.js';
import { rng } from './engine/deck.js';
import { projectView } from './engine/views.js';
import {
  isSeq, RoomHistory,
  type SeatRecord, type SeatTransaction, type TxActor, type TxSecret,
} from './history.js';

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
  /** Public, stable identity — never the token. Seats are renumbered by the
   *  rematch compaction; this is what a transaction written before it still
   *  points at afterwards. */
  id: string;
  /** How far into the journal this player is known to have everything. Held on
   *  the player record on purpose: the compaction moves whole records, so the
   *  pointer travels with its owner instead of with a seat number. */
  historyCursor: number;
}

export interface Room {
  code: string;
  createdAtMs: number; emptySinceMs: number | null;
  phase: Phase; players: RoomPlayer[]; hostSeat: number;
  game: GameState | null; winTally: number[]; seed: number;
  rules: Rules;
  pin: string | null; // ephemeral room secret, plain text by design (rate limits guard it)
  /** Accepted changes, in order, capped and swept with the room. Never learns
   *  the PIN or a token: see `setPin`. */
  history: RoomHistory;
}

export type HistoryHead =
  | { ok: true; seq: number; firstSeq: number; seatEpoch: number }
  | { ok: false; error: 'table_not_found' };

export type HistoryCursor =
  | { ok: true; seq: number }
  | { ok: false; error: 'table_not_found' | 'no_such_seat' };

export type HistoryCatchUp =
  | {
    ok: true; entries: SeatTransaction[]; seq: number; firstSeq: number;
    crossedRebuild: boolean;
  }
  | { ok: false; error: 'table_not_found' }
  | {
    ok: false;
    error: 'no_such_seat' | 'bad_cursor' | 'cursor_ahead' | 'history_truncated';
    seq: number; firstSeq: number;
  };

export type HistoryAck =
  | { ok: true; seq: number }
  | { ok: false; error: 'table_not_found' | 'no_such_seat' | 'bad_cursor' | 'cursor_ahead' };

const norm = (code: string) => code.toUpperCase().replace(/[\s-]/g, '');

/** A seat is an array index, never a string key: `'__proto__'` would reach
 *  `Array.prototype`, `'length'` a number, and `'1'` the right player under a
 *  key the engine's `s.turn === seat` comparison can never match again. */
const isSeatIndex = (seat: number, len: number): boolean =>
  typeof seat === 'number' && Number.isSafeInteger(seat) && seat >= 0 && seat < len;

/** `RegExp.test` coerces, so the typeof comes first: a numeric 1234 would
 *  otherwise be stored and never match the string a client sends back. */
const isPin = (pin: unknown): pin is string => typeof pin === 'string' && /^\d{4}$/.test(pin);

/** Omit that distributes over a discriminated union, so each Action variant
 *  keeps its own payload fields (plain Omit collapses them to just `type`). */
type SeatlessAction = Action extends infer A ? (A extends Action ? Omit<A, 'seat'> : never) : never;

/** What each seat gained since `before`, by card id. One rule covers every way
 *  cards reach a hand — a draw, a +2 pot, a catch penalty, a fresh deal — so no
 *  private card can slip into the journal's public half by being forgotten
 *  here, and none can be missed by a caller enumerating effects by hand. */
function handGains(
  before: GameState | null, after: GameState, players: RoomPlayer[],
): TxSecret[] {
  const out: TxSecret[] = [];
  for (const [seat, p] of after.players.entries()) {
    const owner = players[seat];
    if (!owner) continue;
    const had = new Set((before?.players[seat]?.hand ?? []).map((c) => c.id));
    const gained = p.hand.filter((c) => !had.has(c.id));
    if (gained.length > 0) out.push({ playerId: owner.id, cards: gained });
  }
  return out;
}

/** The public shape of a round, as `projectView` already shows it to everyone. */
const tableFacts = (g: GameState) => ({
  handCounts: g.players.map((p) => p.hand.length),
  turnSeat: g.winner === null ? g.turn : null,
  currentColor: g.currentColor,
  topCard: g.discard.at(-1) ?? null,
});

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
      pin: isPin(opts.pin) ? opts.pin : null,
      history: new RoomHistory(this.now),
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
      id: randomBytes(8).toString('hex'),
      // A new arrival missed nothing: they start level with the journal's head,
      // not at zero, or their first catch-up would replay a table they never sat at.
      historyCursor: room.history.seq,
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

  /** `expectedSocketId`, when passed, pins the update to one socket. A phone
   *  moving Wi-Fi→LTE reconnects in a second while the dead socket's disconnect
   *  lands up to a minute later; without the pin it would darken a live seat. */
  setConnection(code: string, seat: number, socketId: string | null, expectedSocketId?: string | null): void {
    const room = this.getRoom(code);
    if (!room || !isSeatIndex(seat, room.players.length)) return;
    const player = room.players[seat]!;
    if (expectedSocketId !== undefined && player.socketId !== expectedSocketId) return;
    player.socketId = socketId;
    player.connected = socketId !== null;
    player.disconnectedAtMs = socketId === null ? this.now() : null;
    room.emptySinceMs = room.players.some((p) => p.connected && !p.left) ? null : this.now();
  }

  private seatFor(room: Room, token: string): number {
    return room.players.findIndex((p) => p.token === token && !p.left);
  }

  /** `hostSeat` can point at a player removed mid-round; until the rematch
   *  compaction reseats everyone, the first remaining player holds the deal. */
  private hostSeatOf(room: Room): number {
    const host = room.players[room.hostSeat];
    return host && !host.left ? room.hostSeat : room.players.findIndex((p) => !p.left);
  }

  setRules(code: string, token: string, rules: Rules) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: 'table_not_found' };
    const seat = this.seatFor(room, token);
    if (seat !== room.hostSeat) {
      return { ok: false as const, error: 'host_only_rules' };
    }
    if (room.phase !== 'lobby') return { ok: false as const, error: 'rules_locked' };
    room.rules = sanitizeRules(rules);
    room.history.record('rulesChanged', this.actorAt(room, seat), { rules: room.rules }, room.phase);
    return { ok: true as const };
  }

  /** Deliberately unjournalled. The PIN is the room's secret; the audit already
   *  caught it leaking into an engine interface once, and a journal that is
   *  replayed to players is the last place it may appear — not the digits, not
   *  a `pinChanged` marker, not a hash. `hasPin` already rides in every view. */
  setPin(code: string, token: string, pin: string | null) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: 'table_not_found' };
    if (this.seatFor(room, token) !== room.hostSeat) {
      return { ok: false as const, error: 'host_only_rules' };
    }
    if (room.phase !== 'lobby') return { ok: false as const, error: 'rules_locked' };
    if (pin !== null && !isPin(pin)) return { ok: false as const, error: 'bad_pin' };
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
    this.recordDeal(room, this.actorAt(room, seat));
    return { ok: true as const };
  }

  act(code: string, token: string, action: SeatlessAction) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: 'table_not_found' };
    if (room.phase !== 'playing' || !room.game) return { ok: false as const, error: 'no_round' };
    const seat = this.seatFor(room, token);
    if (seat === -1) return { ok: false as const, error: 'seat_not_found' };
    const before = room.game;
    const result = applyAction(room.game, { ...action, seat } as Action);
    // A refused act changed nothing, so there is nothing to remember. Rejections
    // are telemetry (`analytics.moveRejected`), not history.
    if (!result.ok) return result;
    room.game = result.state;
    if (result.state.winner !== null) {
      room.phase = 'roundEnd';
      room.winTally[result.state.winner] = (room.winTally[result.state.winner] ?? 0) + 1;
    }
    room.history.record(
      'move', this.actorAt(room, seat),
      { move: action.type, ...tableFacts(result.state) },
      room.phase,
      { effects: result.effects, secrets: handGains(before, result.state, room.players) },
    );
    if (result.state.winner !== null) this.recordRoundEnd(room, result.state.winner);
    return { ok: true as const, effects: result.effects };
  }

  rematch(code: string, token: string) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: 'table_not_found' };
    if (room.phase !== 'roundEnd') return { ok: false as const, error: 'round_running' };
    const seat = this.seatFor(room, token);
    if (seat === -1) return { ok: false as const, error: 'seat_not_found' };
    if (seat !== this.hostSeatOf(room)) return { ok: false as const, error: 'host_only_deal' };
    // Compact away players who left; keep everyone else's seat order and tally.
    // Every check runs first: a rejected rematch must leave the room untouched,
    // or the seats shift under clients nobody broadcasts to.
    const stayingIdx = room.players.flatMap((p, i) => (p.left ? [] : [i]));
    if (stayingIdx.length < 2) return { ok: false as const, error: 'not_enough_players' };
    const caller = room.players[seat]!;
    room.players = stayingIdx.map((i) => room.players[i]!);
    room.winTally = stayingIdx.map((i) => room.winTally[i]!);
    room.hostSeat = 0;
    // Seat numbers now mean different people. Two things keep a replay honest:
    // every transaction already names its actor by `playerId`, and this boundary
    // marks where the numbering changed — `historySince` reports a window that
    // spans it, so nobody reads an old "seat 2" as the current one. The players'
    // pointers ride along untouched: they live on the records just moved.
    const callerSeat = room.players.indexOf(caller);
    const seats: SeatRecord[] = room.players.map((p, i) => ({ seat: i, playerId: p.id, name: p.name }));
    room.history.reseat({ kind: 'player', playerId: caller.id, seat: callerSeat }, seats, room.phase);
    room.seed = randomInt(2 ** 31);
    room.game = createGame(room.players.length, rng(room.seed), room.rules);
    room.phase = 'playing';
    this.recordDeal(room, this.actorAt(room, callerSeat));
    return { ok: true as const };
  }

  continueWithout(code: string, token: string, targetSeat: number) {
    const room = this.getRoom(code);
    if (!room) return { ok: false as const, error: 'table_not_found' };
    // `room.game` outlives the round, so without the phase check a removal
    // after the last card would score the finished round a second time.
    if (room.phase !== 'playing' || !room.game) return { ok: false as const, error: 'no_round' };
    const actorSeat = this.seatFor(room, token);
    if (actorSeat === -1) return { ok: false as const, error: 'seat_not_found' };
    if (!isSeatIndex(targetSeat, room.players.length)) return { ok: false as const, error: 'no_such_seat' };
    const target = room.players[targetSeat]!;
    if (target.left) return { ok: false as const, error: 'no_such_seat' };
    if (target.connected) return { ok: false as const, error: 'player_connected' };
    if (target.disconnectedAtMs === null || this.now() - target.disconnectedAtMs < CONTINUE_GRACE_MS) {
      return { ok: false as const, error: 'grace_running' };
    }
    const buriedCount = room.game.players[targetSeat]?.hand.length ?? 0;
    target.left = true;
    room.game = removeFromRound(room.game, targetSeat);
    if (room.game.winner !== null) {
      room.phase = 'roundEnd';
      room.winTally[room.game.winner] = (room.winTally[room.game.winner] ?? 0) + 1;
    }
    room.history.record(
      'playerRemoved', this.actorAt(room, actorSeat),
      { seat: targetSeat, playerId: target.id, name: target.name, buriedCount },
      room.phase,
    );
    if (room.game.winner !== null) this.recordRoundEnd(room, room.game.winner);
    return { ok: true as const };
  }

  /** The room reading a consequence, not a player making a move: the actor is
   *  the system, and the number is its own so a client can react to the round
   *  ending without re-deriving it from the move that caused it. */
  private recordRoundEnd(room: Room, winner: number): void {
    room.history.record('roundEnded', { kind: 'system' }, {
      winnerSeat: winner,
      winnerPlayerId: room.players[winner]?.id ?? null,
      winTally: [...room.winTally],
    }, room.phase);
  }

  /** A fresh deal. Hand sizes and the opener are public; the hands themselves
   *  go in as per-player secrets and leave only through the owner's projection.
   *  A deal starts from nothing, so every card in hand counts as gained. */
  private recordDeal(room: Room, actor: TxActor): void {
    const g = room.game;
    if (!g) return;
    room.history.record('roundStarted', actor, {
      handCounts: g.players.map((p) => p.hand.length),
      topCard: g.discard.at(-1) ?? null,
      turnSeat: g.winner === null ? g.turn : null,
    }, room.phase, { secrets: handGains(null, g, room.players) });
  }

  private actorAt(room: Room, seat: number): TxActor {
    const player = room.players[seat];
    return player ? { kind: 'player', playerId: player.id, seat } : { kind: 'system' };
  }

  pausedForSeat(room: Room): number | null {
    if (room.phase !== 'playing') return null;
    const seat = room.players.findIndex((p) => !p.left && !p.connected);
    return seat === -1 ? null : seat;
  }

  /** Absence-expressing form for callers that hold only a code. */
  tryViewFor(code: string, seat: number): RoomStateView | null {
    const room = this.getRoom(code);
    return room === undefined ? null : this.viewOf(room, seat);
  }

  viewFor(code: string, seat: number): RoomStateView {
    const room = this.getRoom(code);
    if (room === undefined) throw new Error(`viewFor: no room ${norm(code)}`);
    return this.viewOf(room, seat);
  }

  private viewOf(room: Room, seat: number): RoomStateView {
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

  // ---- The journal, as the socket layer will ask for it. -------------------
  // Four total questions. A missing room, a seat that is not an index, a number
  // from the future and a number older than the journal keeps are all answers,
  // never throws — the caller decides between a catch-up and a full snapshot
  // from the value it gets back.

  /** Where the journal is now, and how far back it still reaches. */
  historyHead(code: string): HistoryHead {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: 'table_not_found' };
    const { seq, firstSeq, seatEpoch } = room.history;
    return { ok: true, seq, firstSeq, seatEpoch };
  }

  /** How far this seat's player is known to have everything. */
  historyCursor(code: string, seat: number): HistoryCursor {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: 'table_not_found' };
    if (!isSeatIndex(seat, room.players.length)) return { ok: false, error: 'no_such_seat' };
    return { ok: true, seq: room.players[seat]!.historyCursor };
  }

  /** What this seat missed after `afterSeq`, already projected onto it. The
   *  cursor is not moved: the caller acknowledges only once the frames are out. */
  historySince(code: string, seat: number, afterSeq: number): HistoryCatchUp {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: 'table_not_found' };
    const { seq, firstSeq } = room.history;
    if (!isSeatIndex(seat, room.players.length)) {
      return { ok: false, error: 'no_such_seat', seq, firstSeq };
    }
    return room.history.since(afterSeq, room.players[seat]!.id);
  }

  /** Move the pointer forward. Never backward: a late acknowledgement from a
   *  socket that has since been replaced must not re-open a gap that is closed. */
  ackHistory(code: string, seat: number, seq: number): HistoryAck {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: 'table_not_found' };
    if (!isSeatIndex(seat, room.players.length)) return { ok: false, error: 'no_such_seat' };
    if (!isSeq(seq)) return { ok: false, error: 'bad_cursor' };
    if (seq > room.history.seq) return { ok: false, error: 'cursor_ahead' };
    const player = room.players[seat]!;
    player.historyCursor = Math.max(player.historyCursor, seq);
    return { ok: true, seq: player.historyCursor };
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
