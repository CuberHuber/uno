import { describe, expect, test } from 'vitest';
import { buildDeck, rng, shuffle } from '../src/engine/deck.js';

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
