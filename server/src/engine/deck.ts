import type { Card, Color, Value } from '@uno/shared';

export const COLORS: readonly Color[] = ['red', 'yellow', 'green', 'blue'];

/** Colours reach the engine from callers it does not control: never assume one
 *  of the four, check it. */
export const isColor = (v: unknown): v is Color => COLORS.includes(v as Color);

export function buildDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (const color of COLORS) {
    cards.push({ id: id++, color, value: '0' });
    for (let n = 1; n <= 9; n++) {
      const v = String(n) as Value;
      cards.push({ id: id++, color, value: v });
      cards.push({ id: id++, color, value: v });
    }
    for (const v of ['skip', 'reverse', 'draw2'] as const) {
      cards.push({ id: id++, color, value: v });
      cards.push({ id: id++, color, value: v });
    }
  }
  for (let i = 0; i < 4; i++) cards.push({ id: id++, color: null, value: 'wild' });
  for (let i = 0; i < 4; i++) cards.push({ id: id++, color: null, value: 'wild4' });
  return cards;
}

/** mulberry32 — small deterministic PRNG, good enough for card shuffling. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], random: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
