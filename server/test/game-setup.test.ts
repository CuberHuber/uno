import { describe, expect, test } from 'vitest';
import type { Card } from '@uno/shared';
import { createGame, nextSeat } from '../src/engine/game.js';
import { buildDeck, rng, shuffle } from '../src/engine/deck.js';

const isNum = (c: Card) => /^\d$/.test(c.value);

/** The two cards `createGame` would reach for, in order: dealing pops 7 per player
 *  off the end of the shuffled deck, and the flip takes the next one down. */
function wouldFlip(seed: number, players = 3): [Card, Card] {
  const pile = shuffle(buildDeck(), rng(seed));
  const i = pile.length - 7 * players - 1;
  return [pile[i]!, pile[i - 1]!];
}

function findSeed(pred: (flips: [Card, Card]) => boolean, players = 3): number {
  for (let seed = 0; seed < 5000; seed++) if (pred(wouldFlip(seed, players))) return seed;
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

  test('the opening card is always a number, never an action or a wild', () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(createGame(3, rng(seed)).discard[0]!.value).toMatch(/^\d$/);
    }
  });

  test('a flipped special card is buried at the bottom of the draw pile', () => {
    // A seed that would have flipped a special card with a number right behind it:
    // the special goes under the pile (index 0 — cards are drawn from the end) and
    // stays in play, and the number below it opens the round instead.
    const seed = findSeed(([first, second]) => !isNum(first) && isNum(second));
    const [buried, opener] = wouldFlip(seed);
    const g = createGame(3, rng(seed));
    expect(g.drawPile[0]!.id).toBe(buried.id);
    expect(g.discard[0]!.id).toBe(opener.id);
    expect(g.drawPile.length + g.discard.length + g.players.reduce((n, p) => n + p.hand.length, 0)).toBe(108);
  });

  test('the round opens on seat 0, on the card colour, with no colour pending', () => {
    for (let seed = 0; seed < 50; seed++) {
      const g = createGame(3, rng(seed));
      expect(g.turn).toBe(0);
      expect(g.direction).toBe(1);
      expect(g.currentColor).toBe(g.discard[0]!.color);
      expect(g.mustChooseColor).toBe(false);
      expect(g.players[0]!.hand).toHaveLength(7); // no opening penalty is possible
    }
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
