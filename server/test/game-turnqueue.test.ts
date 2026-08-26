import { describe, expect, test } from 'vitest';
import { applyAction, createGame, nextSeat, removeFromRound, type GameState } from '../src/engine/game.js';
import {
  afterReverse, inRound, next, queueOf, reversed, ring, seatOfTurn, without,
  type TurnQueue,
} from '../src/engine/seating.js';
import { rng } from '../src/engine/deck.js';
import { card, fixedState } from './game-play.test.js';
import type { Card } from '@uno/shared';

/** Play one card and insist it was legal: a broken chain must fail as a wrong
 *  seat, not as a silently skipped step. */
function play(s: GameState, seat: number, c: Card): GameState {
  const r = applyAction(s, { type: 'play', seat, cardIds: [c.id] });
  if (!r.ok) throw new Error(`seat ${seat} could not play ${c.color} ${c.value}: ${r.error}`);
  return r.state;
}

const filler = () => card('blue', '9'); // never played, only keeps a hand from emptying

describe('the queue as a value', () => {
  test('walks the ring both ways and wraps', () => {
    const q = ring(4);
    expect(seatOfTurn(next(q))).toBe(1);
    expect(seatOfTurn(next(q, 3))).toBe(3);
    expect(seatOfTurn(next(q, 4))).toBe(0);
    expect(seatOfTurn(next(reversed(q)))).toBe(3);
    expect(seatOfTurn(next(reversed(q), 2))).toBe(2);
  });

  test('places out of the round are stepped over, not counted', () => {
    const q = without(without(ring(5), 1), 2);
    expect(inRound(q)).toEqual([0, 3, 4]);
    expect(seatOfTurn(next(q))).toBe(3);
    expect(seatOfTurn(next(q, 2))).toBe(4);
    expect(seatOfTurn(next(q, 3))).toBe(0); // a whole lap of the live ring
  });

  test('a ring with nobody in the round answers instead of spinning', () => {
    let q = ring(3);
    for (const seat of [0, 1, 2]) q = without(q, seat);
    expect(inRound(q)).toEqual([]);
    expect(seatOfTurn(q)).toBeNull();
    expect(seatOfTurn(next(q, 99))).toBeNull();
    expect(seatOfTurn(next(ring(0)))).toBeNull();
  });

  test('the cursor steps off a place that leaves the round', () => {
    const q = ring(4); // turn on seat 0
    expect(seatOfTurn(without(q, 0))).toBe(1);
    expect(seatOfTurn(without(reversed(q), 0))).toBe(3);
    expect(seatOfTurn(without(q, 2))).toBe(0); // someone else leaving does not move it
  });

  test('reversing a ring of two is the same ring, so the card lands as a skip', () => {
    const two = without(ring(3), 2); // seats 0 and 1 left, turn on 0
    expect(seatOfTurn(afterReverse(two))).toBe(0);
    expect(afterReverse(two).step).toBe(1); // the ring is left facing the way it was
    const three = ring(3);
    expect(seatOfTurn(afterReverse(three))).toBe(2);
    expect(afterReverse(three).step).toBe(-1);
  });

  test('the queue is plain data: structuredClone carries all of it', () => {
    const g = createGame(4, rng(7));
    const q = queueOf(g);
    expect(structuredClone(q)).toEqual(q);
    expect(structuredClone(next(without(q, 1)))).toEqual(next(without(q, 1)));
  });
});

describe('the turn never breaks step', () => {
  test('a long game of reverses and skips hands the turn on one seat at a time', () => {
    const r1 = card('red', '1'), rSkipA = card('red', 'skip'), rDraw2 = card('red', 'draw2');
    const rRevB = card('red', 'reverse');
    const rRevC = card('red', 'reverse'), r4 = card('red', '4'), r6 = card('red', '6');
    const r2 = card('red', '2'), rSkipD = card('red', 'skip'), rRevD = card('red', 'reverse');
    const s0 = fixedState([
      [r1, rSkipA, rDraw2, filler(), filler()],
      [rRevB, filler(), filler(), filler()],
      [rRevC, r4, r6, filler(), filler()],
      [r2, rSkipD, rRevD, filler(), filler()],
      [filler(), filler()],
    ], card('red', '7'));

    const script: [number, Card][] = [
      [0, r1],      // 5 in the round, up:   0 -> 1
      [1, rRevB],   // turn the ring round:  1 -> 0
      [0, rSkipA],  // down, one skipped:    0 -> 3
      [3, r2],      // down:                 3 -> 2
      [2, rRevC],   // turn it back:         2 -> 3
      [3, rSkipD],  // up, one skipped:      3 -> 0
      [0, rDraw2],  // seat 1 draws and is skipped: 0 -> 2
      [2, r4],      // up:                   2 -> 3
      [3, rRevD],   // turn the ring round:  3 -> 2
      [2, r6],      // down:                 2 -> 1
    ];

    let s = s0;
    const chain: number[] = [];
    for (const [seat, c] of script) { s = play(s, seat, c); chain.push(s.turn); }
    expect(chain).toEqual([1, 0, 3, 2, 3, 0, 2, 3, 2, 1]);
    expect(s.players[1]!.hand).toHaveLength(3 + 2); // the draw2 victim really was served
  });

  test('every player gets the turn once a lap, three laps running', () => {
    const hands = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => card('red', '5')));
    let s = fixedState(hands, card('red', '7'));
    const chain: number[] = [];
    for (let i = 0; i < 15; i++) {
      const seat = s.turn;
      const hand = s.players[seat]!.hand;
      s = play(s, seat, hand[0]!);
      chain.push(s.turn);
    }
    expect(chain).toEqual([1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0]);
    for (let lap = 0; lap < 3; lap++) {
      expect(new Set(chain.slice(lap * 5, lap * 5 + 5)).size).toBe(5); // no repeat inside a lap
    }
  });

  test('a player leaving mid-lap drops out of the order and nothing else shifts', () => {
    const hands = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => card('red', '5')));
    let s: GameState = fixedState(hands, card('red', '7'));
    s = play(s, 0, s.players[0]!.hand[0]!);   // turn 1
    expect(s.turn).toBe(1);
    s = removeFromRound(s, 3);                // not their turn: the turn stays put
    expect(s.turn).toBe(1);
    const chain: number[] = [];
    for (let i = 0; i < 8; i++) {
      const seat = s.turn;
      s = play(s, seat, s.players[seat]!.hand[0]!);
      chain.push(s.turn);
    }
    expect(chain).toEqual([2, 4, 0, 1, 2, 4, 0, 1]); // seat 3 is gone, the rest keep their order
  });

  test('the player holding the turn leaves: the turn moves on, the lap keeps going', () => {
    const hands = Array.from({ length: 4 }, () => Array.from({ length: 5 }, () => card('red', '5')));
    let s: GameState = fixedState(hands, card('red', '7'));
    s = play(s, 0, s.players[0]!.hand[0]!);   // turn 1
    s = removeFromRound(s, 1);                // their turn, and they walk out
    expect(s.turn).toBe(2);
    expect(s.pendingDraw).toBe(0);
    const chain: number[] = [];
    for (let i = 0; i < 6; i++) {
      const seat = s.turn;
      s = play(s, seat, s.players[seat]!.hand[0]!);
      chain.push(s.turn);
    }
    expect(chain).toEqual([3, 0, 2, 3, 0, 2]);
  });

  test('a leaver at the seam is stepped over going the other way too', () => {
    const hands = Array.from({ length: 4 }, () => Array.from({ length: 5 }, () => card('red', '5')));
    const rev = card('red', 'reverse');
    let s: GameState = fixedState(hands, card('red', '7'));
    s.players[0]!.hand.push(rev);
    s = play(s, 0, rev);                      // 4 in the round: flip and hand on
    expect(s.direction).toBe(-1);
    expect(s.turn).toBe(3);
    s = removeFromRound(s, 3);                // the new turn holder leaves at once
    expect(s.turn).toBe(2);
    const chain: number[] = [];
    for (let i = 0; i < 5; i++) {
      const seat = s.turn;
      s = play(s, seat, s.players[seat]!.hand[0]!);
      chain.push(s.turn);
    }
    expect(chain).toEqual([1, 0, 2, 1, 0]);
  });

  test('reverse is a skip whenever two are left, however many seats the table has', () => {
    const hands = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => card('red', '5')));
    const rev = card('red', 'reverse');
    let s: GameState = fixedState(hands, card('red', '7'));
    s.players[0]!.hand.push(rev);
    s = removeFromRound(s, 1);
    s = removeFromRound(s, 3);                // seats 0 and 2 are the whole round now
    expect(s.turn).toBe(0);
    s = play(s, 0, rev);
    expect(s.turn).toBe(0);                   // same player again
    expect(s.direction).toBe(1);              // and the ring is left as it was
    s = play(s, 0, s.players[0]!.hand[0]!);
    expect(s.turn).toBe(2);
  });
});

/** A second, independent statement of the same order: the live seats as a plain
 *  list with a cursor on it. If the ring and the list ever disagree about who is
 *  next, one of them is wrong. */
class Reference {
  live: number[];
  at: number;
  dir: 1 | -1 = 1;
  constructor(count: number) { this.live = Array.from({ length: count }, (_, i) => i); this.at = 0; }
  private mod(i: number) { return ((i % this.live.length) + this.live.length) % this.live.length; }
  seat(): number | null { return this.at === -1 ? null : this.live[this.at] ?? null; }
  pass(steps: number) { if (this.live.length > 0) this.at = this.mod(this.at + this.dir * steps); }
  reverse() {
    if (this.live.length > 2) { this.dir = this.dir === 1 ? -1 : 1; this.pass(1); } else this.pass(2);
  }
  remove(seat: number) {
    const i = this.live.indexOf(seat);
    if (i === -1) return;
    const held = i === this.at;
    this.live.splice(i, 1);
    if (this.live.length === 0) { this.at = -1; return; }
    if (held) this.at = this.dir === 1 ? this.mod(i) : this.mod(i - 1);
    else if (i < this.at) this.at -= 1;
  }
}

describe('the ring agrees with a straight list of live seats', () => {
  test('over thousands of random passes, reverses and departures', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const random = rng(seed);
      const count = 2 + Math.floor(random() * 6);
      let q: TurnQueue = ring(count);
      const ref = new Reference(count);
      for (let op = 0; op < 60; op++) {
        const roll = random();
        if (roll < 0.55) { const steps = 1 + Math.floor(random() * 3); q = next(q, steps); ref.pass(steps); }
        else if (roll < 0.8) { q = afterReverse(q); ref.reverse(); }
        else { const seat = Math.floor(random() * count); q = without(q, seat); ref.remove(seat); }
        expect([seed, op, seatOfTurn(q)]).toEqual([seed, op, ref.seat()]);
        expect(inRound(q)).toEqual(ref.live);
      }
    }
  });
});

describe('nextSeat still answers for its old callers', () => {
  test('it reads the queue without moving anything', () => {
    const g = createGame(4, rng(3));
    const before = JSON.stringify(g);
    expect(nextSeat(g, 0)).toBe(1);
    expect(nextSeat(g, 3)).toBe(0);
    expect(nextSeat({ ...g, direction: -1 }, 0, 2)).toBe(2);
    expect(JSON.stringify(g)).toBe(before);
  });
});
