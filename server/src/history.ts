import type { Card, Color, Effect, Phase, Rules } from '@uno/shared';

/** How many transactions one room keeps. A round runs well under a hundred
 *  accepted acts, so this covers the current round and the one before it.
 *  Anything older is a reconnect only a fresh snapshot can answer — and the
 *  caller is told so rather than handed a list with a hole in it. */
export const MAX_TRANSACTIONS = 200;

/** A player's public, stable name. It is *not* the token: the token
 *  authenticates and must never be written down anywhere else, this only
 *  identifies. It is minted once per seated player and travels with the player
 *  record through the rematch compaction, so a transaction written before the
 *  compaction still points at the same human afterwards. */
export type PlayerId = string;

export interface SeatRecord { seat: number; playerId: PlayerId; name: string }

/** Who caused the change. `seat` is the seat *as of this transaction's
 *  `seatEpoch`*; `playerId` is the part that keeps its meaning across a
 *  reseating. `system` is the room itself drawing a consequence — the round
 *  ending is nobody's move. */
export type TxActor =
  | { kind: 'player'; playerId: PlayerId; seat: number }
  | { kind: 'system' };

export type MoveKind = 'play' | 'draw' | 'pass' | 'callLastCard' | 'catchLastCard';

/** The public payload of each kind of transaction.
 *
 *  Every field here is already something `projectView` hands to *every* seat:
 *  `handCounts` is `SeatView.cardCount`, `topCard` / `currentColor` /
 *  `turnSeat` / `winTally` / `rules` are `RoomStateView` fields, names and
 *  seats are the seat list. That containment is the whole safety argument —
 *  replaying a payload can never say more than the snapshot already said.
 *
 *  Anything narrower than "the whole table may see it" does not live here. It
 *  lives in `secrets`, keyed by the one player it belongs to. */
export interface TxPayloads {
  /** A round was dealt. The hands themselves ride in `secrets`. */
  roundStarted: { handCounts: number[]; topCard: Card | null; turnSeat: number | null };
  /** One accepted act. `effects` carries what the table saw happen. */
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
  /** The rematch compaction: from here on the seat numbers mean new people.
   *  A boundary, deliberately loud, so a replay cannot silently mis-attribute. */
  seatsRebuilt: { seats: SeatRecord[] };
}

export type TxKind = keyof TxPayloads;

/** Cards one player alone may see: what they were dealt, what they drew, what
 *  a penalty handed them. Stored beside the public transaction, never inside
 *  it, so no spread of a transaction can carry them out. */
export interface TxSecret { playerId: PlayerId; cards: Card[] }

interface TxCommon {
  seq: number;
  atMs: number;
  /** Which seating the `seat` numbers in this transaction belong to. */
  seatEpoch: number;
  actor: TxActor;
  effects: Effect[];
  /** The room's phase once this change had been applied. */
  phase: Phase;
}

/** A transaction as everyone may read it. Nothing private is reachable from
 *  this type — that is the point of it being a separate type. */
export type PublicTransaction = {
  [K in TxKind]: TxCommon & { kind: K; payload: TxPayloads[K] };
}[TxKind];

/** A transaction projected onto one seat: the public part verbatim, plus the
 *  cards that seat — and only that seat — was allowed to see. */
export type SeatTransaction = PublicTransaction & { yourCards: Card[] | null };

/** The stored form. The secrets sit *next to* the public transaction, never in
 *  it: `since` builds its answer from `entry.tx` alone and reaches `secrets`
 *  only through a `playerId` match. */
interface Entry { tx: PublicTransaction; secrets: TxSecret[] }

export type HistorySince =
  | {
    ok: true; entries: SeatTransaction[]; seq: number; firstSeq: number;
    /** The window contains a reseating, so the seat numbers inside it are not
     *  all the seat numbers in force now. */
    crossedRebuild: boolean;
  }
  | { ok: false; error: 'bad_cursor' | 'cursor_ahead' | 'history_truncated'; seq: number; firstSeq: number };

/** A transaction number is a counter, not an index — but it still arrives from
 *  the wire, and `'1'`, `1.5` and `NaN` all compare in ways that mislead. */
export const isSeq = (seq: number): boolean =>
  typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 0;

/** The room's own memory of what happened, in order. Lives and dies with the
 *  room — no store, no file, no database — and is capped so a long table cannot
 *  grow without bound. */
export class RoomHistory {
  private entries: Entry[] = [];
  private lastSeq = 0;
  private epoch = 0;

  constructor(private now: () => number = Date.now, private readonly limit: number = MAX_TRANSACTIONS) {}

  /** The newest transaction number. It grows for the whole life of the room and
   *  never restarts — not between rounds, not across a rematch — so a pointer
   *  handed out before a rematch still means what it meant. */
  get seq(): number { return this.lastSeq; }

  /** The oldest transaction still kept. A pointer below `firstSeq - 1` has
   *  fallen off the back of the journal: that gap is reported, never papered
   *  over. When nothing is kept this reads as `seq + 1` — nothing is missing. */
  get firstSeq(): number { return this.entries[0]?.tx.seq ?? this.lastSeq + 1; }

  /** Which generation of seat numbers is in force. Bumped by `reseat`. */
  get seatEpoch(): number { return this.epoch; }

  get size(): number { return this.entries.length; }

  /** Append one accepted change. The generic ties `payload` to `kind` at every
   *  call site, which is where the correlation has to hold; the cast below only
   *  re-states it for the union. */
  record<K extends TxKind>(
    kind: K,
    actor: TxActor,
    payload: TxPayloads[K],
    phase: Phase,
    opts: { effects?: Effect[]; secrets?: TxSecret[] } = {},
  ): number {
    this.lastSeq += 1;
    const tx = {
      seq: this.lastSeq,
      atMs: this.now(),
      seatEpoch: this.epoch,
      actor,
      kind,
      payload,
      effects: opts.effects ?? [],
      phase,
    } as PublicTransaction;
    const secrets = (opts.secrets ?? []).filter((s) => s.cards.length > 0);
    this.entries.push({ tx, secrets });
    // Trim from the front. Numbers are never reused, so the sequence the
    // survivors carry stays unbroken and `firstSeq` simply moves up.
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    return this.lastSeq;
  }

  /** The rematch compaction, written down. The epoch moves first, so the
   *  boundary transaction itself already speaks in the new seat numbers. */
  reseat(actor: TxActor, seats: SeatRecord[], phase: Phase): number {
    this.epoch += 1;
    return this.record('seatsRebuilt', actor, { seats }, phase);
  }

  /** Everything after `afterSeq`, projected onto the player `viewerId`.
   *  Total: every refusal is a value, never a throw. */
  since(afterSeq: number, viewerId: PlayerId): HistorySince {
    const seq = this.lastSeq;
    const firstSeq = this.firstSeq;
    if (!isSeq(afterSeq)) return { ok: false, error: 'bad_cursor', seq, firstSeq };
    if (afterSeq > seq) return { ok: false, error: 'cursor_ahead', seq, firstSeq };
    // The next number this player needs is `afterSeq + 1`. If the journal no
    // longer holds it, catch-up is impossible and the caller must fall back to
    // a snapshot — quietly returning what is left would drop moves.
    if (afterSeq + 1 < firstSeq) return { ok: false, error: 'history_truncated', seq, firstSeq };
    const entries: SeatTransaction[] = [];
    let crossedRebuild = false;
    for (const entry of this.entries) {
      if (entry.tx.seq <= afterSeq) continue;
      if (entry.tx.kind === 'seatsRebuilt' || entry.tx.seatEpoch !== this.epoch) crossedRebuild = true;
      entries.push(project(entry, viewerId));
    }
    return { ok: true, entries, seq, firstSeq, crossedRebuild };
  }
}

/** The one door from stored state to a player. The public transaction is
 *  spread whole — it has no private field to carry — and the only thing added
 *  is the secret whose `playerId` is this viewer's. There is no other path
 *  from `entry.secrets` to the outside. */
function project(entry: Entry, viewerId: PlayerId): SeatTransaction {
  const mine = entry.secrets.find((s) => s.playerId === viewerId);
  return { ...entry.tx, yourCards: mine ? mine.cards : null };
}
