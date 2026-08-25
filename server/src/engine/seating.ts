/**
 * The turn queue.
 *
 * Whose turn it is, which way the turn travels, and who is still in the round are
 * one thing, not three: a ring of places with a cursor standing on it. This module
 * owns that ring. It is the only code in the engine that writes `turn`, `direction`
 * and `removed`, and every rule that moves the turn is stated here exactly once.
 *
 * The queue is plain data on purpose. `applyAction` copies the whole game with
 * `structuredClone`, which drops methods and throws `DataCloneError` on anything
 * that is not a plain object, so no behaviour may sit inside the state. Behaviour
 * lives in the functions below: each takes a queue and returns a new one, and
 * nothing here mutates a queue it was given.
 *
 * Every walk round the ring is bounded by the ring itself — at most one lap per
 * step — so a table with nobody left in the round answers with a value instead of
 * spinning forever.
 */

/** One place at the table: its seat number, and whether its player is still in
 *  the round. A place is never taken out of the ring — only out of the round —
 *  so the cursor keeps its bearings when the player holding the turn walks away. */
export interface Place {
  readonly seat: number;
  readonly inRound: boolean;
}

/** The ring of places, where the turn stands on it, and the way it travels. */
export interface TurnQueue {
  readonly places: readonly Place[];
  readonly at: number;      // index into `places`, or NOWHERE
  readonly step: 1 | -1;    // which way round the ring the turn walks
}

/** The cursor stands on no place at all: an empty table, or a seat number this
 *  table never had. Also what `findIndex` answers, which is why it is -1. */
export const NOWHERE = -1;

const wrap = (i: number, n: number) => (((i % n) + n) % n);

const placeIndex = (places: readonly Place[], seat: number) =>
  places.findIndex((p) => p.seat === seat);

/** A fresh ring: everyone in the round, the turn on the first place, walking up. */
export function ring(count: number): TurnQueue {
  const size = Number.isInteger(count) && count > 0 ? count : 0;
  const places = Array.from({ length: size }, (_, seat) => ({ seat, inRound: true }));
  return { places, at: size > 0 ? 0 : NOWHERE, step: 1 };
}

/** The seat whose turn it is — only when the cursor stands on a place still in the
 *  round. `null` says the queue has nobody to act: the caller has to answer for
 *  that case instead of receiving a seat that cannot play. */
export function seatOfTurn(q: TurnQueue): number | null {
  if (q.at === NOWHERE) return null;
  const place = q.places[q.at];
  return place && place.inRound ? place.seat : null;
}

/** The seats still in the round, in seating order. */
export function inRound(q: TurnQueue): number[] {
  return q.places.filter((p) => p.inRound).map((p) => p.seat);
}

/** Hand the turn to the next place still in the round, one hop at a time. */
function handOn(q: TurnQueue): TurnQueue {
  const n = q.places.length;
  if (n === 0) return q;
  if (q.at === NOWHERE) {
    // The cursor lost its place. Rather than freeze the table, the turn starts
    // over from the first place still in the round.
    const first = q.places.findIndex((p) => p.inRound);
    return first === NOWHERE ? q : { ...q, at: first };
  }
  // One lap is the whole ring: if no place on it is in the round there is nobody
  // to hand the turn to, and the walk answers with the queue it was given.
  for (let hop = 1; hop <= n; hop++) {
    const at = wrap(q.at + hop * q.step, n);
    const place = q.places[at];
    if (place && place.inRound) return { ...q, at };
  }
  return q;
}

/** The queue after the turn has been handed on `steps` places. */
export function next(q: TurnQueue, steps = 1): TurnQueue {
  const laps = Number.isFinite(steps) ? Math.max(0, Math.floor(steps)) : 0;
  let moved = q;
  for (let i = 0; i < laps; i++) moved = handOn(moved);
  return moved;
}

/** The same ring, walked the other way. */
export function reversed(q: TurnQueue): TurnQueue {
  return { ...q, step: q.step === 1 ? -1 : 1 };
}

/** A reverse card. Turn the ring around, then hand the turn on.
 *
 *  A ring of two (or one) is its own reverse: walking it the other way reaches the
 *  same place, so the flip cannot change who is next. That is the whole of the
 *  "reverse acts as a skip with two players" rule — it is not a separate case
 *  bolted onto the turn, it is what a degenerate ring does. The turn is handed on
 *  twice instead, which on such a ring comes back to the player who laid the card,
 *  and the ring is left facing the way it was. */
export function afterReverse(q: TurnQueue): TurnQueue {
  return inRound(q).length > 2 ? next(reversed(q)) : next(q, 2);
}

/** The queue with one seat out of the round. */
export function without(q: TurnQueue, seat: number): TurnQueue {
  const places = q.places.map((p) => (p.seat === seat ? { seat: p.seat, inRound: false } : p));
  return settled({ ...q, places });
}

/** The queue's own invariant: the cursor never rests on a place that has left the
 *  round while any place is still in it. */
export function settled(q: TurnQueue): TurnQueue {
  return seatOfTurn(q) === null && inRound(q).length > 0 ? next(q) : q;
}

/* ------------------------------------------------------------------ *
 * The queue inside a game state.
 *
 * `GameState` keeps the queue spread over the three fields it has always had —
 * `turn`, `direction` and `players[].removed` — because the wire projection reads
 * them. Those fields are the queue's storage and nothing else: they are read in
 * one function here and written in one function here, so there is still a single
 * place that decides the order of play.
 * ------------------------------------------------------------------ */

/** As much of a game state as the queue is allowed to know about. */
export interface Seating {
  players: { removed: boolean }[];
  turn: number;
  direction: 1 | -1;
}

/** Read the queue out of a state. */
export function queueOf(s: Seating): TurnQueue {
  const places = s.players.map((p, seat) => ({ seat, inRound: !p.removed }));
  return {
    places,
    at: placeIndex(places, s.turn),
    step: s.direction === -1 ? -1 : 1,
  };
}

/** Write the queue back. The only assignment to `turn`, `direction` and `removed`
 *  in the engine. A queue standing nowhere leaves `turn` alone: there is no seat
 *  to name, and inventing one would be worse than saying nothing. */
export function applyQueue(s: Seating, q: TurnQueue): void {
  const standing = q.at === NOWHERE ? undefined : q.places[q.at];
  if (standing) s.turn = standing.seat;
  s.direction = q.step;
  for (const place of q.places) {
    const player = s.players[place.seat];
    if (player) player.removed = !place.inRound;
  }
}

/** Where a round starts: the first place, walking up. */
export function openingSeating(count: number): { turn: number; direction: 1 | -1 } {
  const q = ring(count);
  return { turn: seatOfTurn(q) ?? 0, direction: q.step };
}

/** Hand the turn on `steps` places. */
export function passTurn(s: Seating, steps = 1): void {
  applyQueue(s, next(queueOf(s), steps));
}

/** Play a reverse: turn the ring around and hand the turn on. */
export function reverseTurn(s: Seating): void {
  applyQueue(s, afterReverse(queueOf(s)));
}

/** Take a seat out of the round. The turn moves off it in the same breath, so no
 *  caller has to remember that a leaver may have been holding it. */
export function withdrawSeat(s: Seating, seat: number): void {
  applyQueue(s, without(queueOf(s), seat));
}

/** Who would get the turn `steps` places on from `from`, without moving it. */
export function seatAfter(s: Seating, from: number, steps = 1): number {
  const q = queueOf(s);
  const moved = next({ ...q, at: placeIndex(q.places, from) }, steps);
  return seatOfTurn(moved) ?? from;
}

/** The seats still in the round, in seating order. */
export function seatsInRound(s: Seating): number[] {
  return inRound(queueOf(s));
}
