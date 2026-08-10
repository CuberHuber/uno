import { describe, expect, test } from 'vitest';
import { createGame, nextSeat } from '../src/engine/game.js';
import { rng } from '../src/engine/deck.js';

function findSeed(pred: (g: ReturnType<typeof createGame>) => boolean, players = 3): number {
  for (let seed = 0; seed < 5000; seed++) {
    if (pred(createGame(players, rng(seed)))) return seed;
  }
  throw new Error('no seed found');
}

describe('createGame', () => {
  test('deals 7 cards to each player and flips one discard', () => {
    const g = createGame(4, rng(1));
    expect(g.players).toHaveLength(4);
    for (const p of g.players) expect(p.hand.length).toBeGreaterThanOrEqual(7);
    expect(g.discard).toHaveLength(1);
    expect(g.drawPile.length + g.discard.length + g.players.reduce((n, p) => n + p.hand.length, 0)).toBe(108);
  });

  test('first flip is never wild4', () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(createGame(3, rng(seed)).discard[0]!.value).not.toBe('wild4');
    }
  });

  test('number flip: seat 0 starts, color = card color', () => {
    const seed = findSeed((g) => /^[0-9]$/.test(g.discard[0]!.value));
    const g = createGame(3, rng(seed));
    expect(g.turn).toBe(0);
    expect(g.currentColor).toBe(g.discard[0]!.color);
    expect(g.mustChooseColor).toBe(false);
  });

  test('skip flip: seat 0 is skipped, seat 1 starts', () => {
    const seed = findSeed((g) => g.discard[0]!.value === 'skip');
    expect(createGame(3, rng(seed)).turn).toBe(1);
  });

  test('draw2 flip: seat 0 draws two (9 cards) and seat 1 starts', () => {
    const seed = findSeed((g) => g.discard[0]!.value === 'draw2');
    const g = createGame(3, rng(seed));
    expect(g.players[0]!.hand).toHaveLength(9);
    expect(g.turn).toBe(1);
  });

  test('reverse flip: direction flips and last seat starts', () => {
    const seed = findSeed((g) => g.discard[0]!.value === 'reverse');
    const g = createGame(3, rng(seed));
    expect(g.direction).toBe(-1);
    expect(g.turn).toBe(2);
  });

  test('wild flip: seat 0 must choose color before anything else', () => {
    const seed = findSeed((g) => g.discard[0]!.value === 'wild');
    const g = createGame(3, rng(seed));
    expect(g.turn).toBe(0);
    expect(g.currentColor).toBeNull();
    expect(g.mustChooseColor).toBe(true);
  });
});

describe('nextSeat', () => {
  test('wraps forward and backward', () => {
    const g = createGame(3, rng(1));
    expect(nextSeat({ ...g, direction: 1 }, 2)).toBe(0);
    expect(nextSeat({ ...g, direction: -1 }, 0)).toBe(2);
    expect(nextSeat({ ...g, direction: 1 }, 0, 2)).toBe(2);
  });
});
