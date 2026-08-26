export type Color = 'red' | 'yellow' | 'green' | 'blue';
export type Value =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';

export interface Card {
  id: number;
  color: Color | null; // null for wild / wild4
  value: Value;
}

export type Phase = 'lobby' | 'playing' | 'roundEnd';

export interface Rules {
  stacking: boolean;     // +2 answers only +2, +4 answers only +4; the pot rides on
  forcePlay: boolean;    // a drawn playable card goes straight down
  drawToMatch: boolean;  // no play → draw until a playable card arrives
  multiDiscard: boolean; // same-value number cards may be discarded together
}
export const CLASSIC_RULES: Rules = {
  stacking: false, forcePlay: false, drawToMatch: false, multiDiscard: false,
};
export const sanitizeRules = (r?: Partial<Rules> | null): Rules => ({
  stacking: !!r?.stacking, forcePlay: !!r?.forcePlay,
  drawToMatch: !!r?.drawToMatch, multiDiscard: !!r?.multiDiscard,
});

export interface SeatView {
  seat: number;
  name: string;
  cardCount: number;
  connected: boolean;
  calledLastCard: boolean;
  isHost: boolean;
}

export interface RoomStateView {
  roomCode: string;
  phase: Phase;
  yourSeat: number;
  hand: Card[];
  seats: SeatView[];
  turnSeat: number | null;
  direction: 1 | -1;
  topCard: Card | null;
  currentColor: Color | null;
  pendingDrawnCardId: number | null; // you drew a playable card: play it or pass
  catchableSeat: number | null;  // catch window is open on this seat
  drawPileCount: number;
  rules: Rules;
  hasPin: boolean;           // the join screen knows to ask for a PIN
  pin: string | null;        // the digits themselves — host's view only
  pendingDraw: number;           // cards the turn seat owes (stacking pot); 0 otherwise
  pendingDrawKind: 'draw2' | 'wild4' | null; // which kind answers the pot (strict stacking)
  winnerSeat: number | null;
  winTally: number[];
  paused: boolean;
  pausedForName: string | null;
  pausedSinceMs: number | null;  // server epoch ms; client derives the 2-minute mark
}

export type Effect =
  | { type: 'played'; seat: number; cards: Card[] }
  | { type: 'drew'; seat: number; count: number }
  | { type: 'called'; seat: number }
  | { type: 'caught'; seat: number }
  | { type: 'win'; seat: number };

// ── The room's journal, as it crosses the wire ───────────────────────────────
//
// The server keeps an ordered log of accepted changes (`server/src/history.ts`)
// and one pointer per player into it. The types below are the shape that log
// takes when it leaves the server; the server's own types satisfy them
// structurally, and the assignment at the emit site is what checks that.
//
// Nothing here is narrower than "the whole table may see it", with one
// exception that is named as such: `yourCards`, the cards the single player
// this copy was built for is allowed to see.

/** A player's public, stable name — never the token. Seats are renumbered by
 *  the rematch compaction; this is what a transaction written before it still
 *  points at afterwards. */
export type PlayerId = string;

export interface SeatRecord { seat: number; playerId: PlayerId; name: string }

/** Who caused the change. `seat` is the seat *as of this transaction's
 *  `seatEpoch`*; `playerId` is the part that keeps its meaning across a
 *  reseating. `system` is the room drawing a consequence — a round ending is
 *  nobody's move. */
export type TxActor =
  | { kind: 'player'; playerId: PlayerId; seat: number }
  | { kind: 'system' };

export type MoveKind = 'play' | 'draw' | 'pass' | 'callLastCard' | 'catchLastCard';

export interface TxPayloads {
  roundStarted: { handCounts: number[]; topCard: Card | null; turnSeat: number | null };
  move: {
    move: MoveKind;
    handCounts: number[];
    turnSeat: number | null;
    currentColor: Color | null;
    topCard: Card | null;
  };
  roundEnded: { winnerSeat: number | null; winnerPlayerId: PlayerId | null; winTally: number[] };
  playerRemoved: { seat: number; playerId: PlayerId; name: string; buriedCount: number };
  rulesChanged: { rules: Rules };
  /** The rematch compaction: from here on the seat numbers mean new people. */
  seatsRebuilt: { seats: SeatRecord[] };
}

export type TxKind = keyof TxPayloads;

export type PublicTransaction = {
  [K in TxKind]: {
    seq: number;
    atMs: number;
    /** Which seating the `seat` numbers in this transaction belong to. */
    seatEpoch: number;
    actor: TxActor;
    effects: Effect[];
    /** The room's phase once this change had been applied. */
    phase: Phase;
    kind: K;
    payload: TxPayloads[K];
  };
}[TxKind];

/** A transaction as one seat may read it: the public part verbatim, plus the
 *  cards that seat — and only that seat — was allowed to see. */
export type SeatTransaction = PublicTransaction & { yourCards: Card[] | null };

/** The answer to "what happened while I was gone". It never replaces the
 *  snapshot — `roomState` arrives either way — it only says what the gap was
 *  made of. */
export interface CatchUpView {
  /** The journal head this answer was built at. */
  seq: number;
  /** What was missed, oldest first. Empty when the journal could not answer. */
  entries: SeatTransaction[];
  /** The gap ran deeper than the journal keeps. `entries` is empty on purpose:
   *  a list with a hole in it is a worse answer than no list. The pointer has
   *  been moved up to the head and the snapshot is the whole truth. */
  truncated: boolean;
  /** A rematch sits inside the window, so seat numbers before it name other
   *  people than the same numbers name now. */
  crossedRebuild: boolean;
  /** Who is who at the table right now: the only way to put a name to the
   *  `playerId` a transaction carries. Players who have left are absent — the
   *  transaction that removed them carries their name itself. */
  seats: SeatRecord[];
  /** Your own public id, so the list can say "you" where it means you. */
  you: PlayerId;
}

export interface JoinAck {
  ok: boolean;
  error?: string;
  seat?: number;
  token?: string;
  roomName?: string;
}

export interface ClientToServerEvents {
  joinRoom: (
    p: { code: string; name?: string; token?: string; pin?: string },
    ack: (r: JoinAck) => void
  ) => void;
  startGame: () => void;
  setRules: (p: { rules: Rules }) => void; // host, lobby only
  setPin: (p: { pin: string | null }) => void; // host, lobby only
  playCards: (p: { cardIds: number[]; chosenColor?: Color }) => void;
  drawCard: () => void;
  passTurn: () => void;          // decline to play a drawn playable card
  callLastCard: () => void;
  catchLastCard: () => void;
  rematch: () => void;
  continueWithout: (p: { seat: number }) => void;
  /** "I have applied everything up to this number." The pointer it moves only
   *  ever goes forward, so a late acknowledgement from a socket that has since
   *  been replaced cannot re-open a gap that is already closed. */
  ackHistory: (p: { seq: number }) => void;
}

export interface ServerToClientEvents {
  roomState: (view: RoomStateView) => void;
  moveRejected: (p: { reason: string }) => void;
  effect: (e: Effect) => void;
  /** Where the journal stands, sent alongside every snapshot. A snapshot holds
   *  everything up to this number by construction, so applying one is grounds
   *  to acknowledge it — and that, not the reconnect, is what keeps the pointer
   *  level during a live round. */
  historyHead: (p: { seq: number }) => void;
  /** What one player missed while they were away. Sent after the snapshot, and
   *  only when there is something to say. */
  catchUp: (p: CatchUpView) => void;
}
