import { describe, expect, test } from 'vitest';
import {
  advanceSeed, buildDeck, cryptoRandom, newSeed, rng, seedStream, shuffle,
} from '../src/engine/deck.js';

describe('buildDeck', () => {
  const deck = buildDeck();

  test('has exactly 108 cards with unique ids', () => {
    expect(deck).toHaveLength(108);
    expect(new Set(deck.map((c) => c.id)).size).toBe(108);
  });
  test('per color: one 0, two of each 1-9, two skip/reverse/draw2', () => {
    for (const color of ['red', 'yellow', 'green', 'blue'] as const) {
      const of = (v: string) => deck.filter((c) => c.color === color && c.value === v).length;
      expect(of('0')).toBe(1);
      for (let n = 1; n <= 9; n++) expect(of(String(n))).toBe(2);
      expect(of('skip')).toBe(2);
      expect(of('reverse')).toBe(2);
      expect(of('draw2')).toBe(2);
    }
  });
  test('four wilds and four wild4s, colorless', () => {
    expect(deck.filter((c) => c.value === 'wild' && c.color === null)).toHaveLength(4);
    expect(deck.filter((c) => c.value === 'wild4' && c.color === null)).toHaveLength(4);
  });
});

describe('shuffle', () => {
  test('same seed gives same order; different seed differs', () => {
    const a = shuffle(buildDeck(), rng(42)).map((c) => c.id);
    const b = shuffle(buildDeck(), rng(42)).map((c) => c.id);
    const c = shuffle(buildDeck(), rng(7)).map((c) => c.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
  test('does not mutate input and keeps all cards', () => {
    const deck = buildDeck();
    const before = deck.map((c) => c.id);
    const out = shuffle(deck, rng(1));
    expect(deck.map((c) => c.id)).toEqual(before);
    expect([...out.map((c) => c.id)].sort((x, y) => x - y)).toEqual(before);
  });
});

describe('the deal is not reconstructible', () => {
  test('cryptoRandom stays in range and does not repeat itself', () => {
    const r = cryptoRandom();
    const draws = Array.from({ length: 500 }, r);
    for (const v of draws) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    // A source with real entropy has no reason to collide over 500 draws of 48
    // bits; a small-seeded PRNG that had cycled would show up here.
    expect(new Set(draws).size).toBe(draws.length);
  });

  test('two crypto shuffles of the same deck differ', () => {
    const a = shuffle(buildDeck(), cryptoRandom()).map((c) => c.id);
    const b = shuffle(buildDeck(), cryptoRandom()).map((c) => c.id);
    expect(a).not.toEqual(b);
  });

  test('the reshuffle seed is 256 bits, not a 32-bit counter', () => {
    const seed = newSeed(cryptoRandom());
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    // Advancing must not be guessable by adding one: it is a hash step, so the
    // discard pile everyone has already seen tells nobody the next order.
    const next = advanceSeed(seed);
    expect(next).toMatch(/^[0-9a-f]{64}$/);
    expect(next).not.toBe(seed);
  });

  test('seedStream replays exactly for a seed and diverges across seeds', () => {
    const one = shuffle(buildDeck(), seedStream('ab'.repeat(32))).map((c) => c.id);
    const same = shuffle(buildDeck(), seedStream('ab'.repeat(32))).map((c) => c.id);
    const other = shuffle(buildDeck(), seedStream('cd'.repeat(32))).map((c) => c.id);
    expect(one).toEqual(same);
    expect(one).not.toEqual(other);
  });

  test('a seeded game still replays: newSeed is drawn from the caller source', () => {
    expect(newSeed(rng(42))).toBe(newSeed(rng(42)));
    expect(newSeed(rng(42))).not.toBe(newSeed(rng(43)));
  });
});
