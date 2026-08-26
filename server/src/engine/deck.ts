import { createHash, randomBytes } from 'node:crypto';
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

/** The source real rooms deal from. A deal must not be reconstructible: against a
 *  31-bit seed a player who sees nothing but their own hand can brute-force the
 *  seed — Fisher-Yates fixes the last slot on the very first draw, so each guess
 *  dies after two operations — and then read every other hand and the whole draw
 *  order. Drawing from the OS per swap removes the seed there is to guess. */
export function cryptoRandom(): () => number {
  return () => randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
}

/** A reshuffle happens deep inside `applyAction`, which carries no random source
 *  of its own, so the stream has to be rebuildable from state. It still is — but
 *  from a 256-bit seed, which is not brute-forceable the way a 32-bit one is.
 *  The discard pile everyone has already seen must not predict the new order. */
export function seedStream(seedHex: string): () => number {
  let counter = 0;
  return () => {
    const h = createHash('sha256').update(seedHex).update(String(counter++)).digest();
    return h.readUIntBE(0, 6) / 2 ** 48;
  };
}

/** Drawn from the caller's own source: the OS in a real room, the seeded PRNG
 *  under test, so a seeded game still replays exactly. */
export function newSeed(random: () => number): string {
  let out = '';
  for (let i = 0; i < 32; i++) out += Math.floor(random() * 256).toString(16).padStart(2, '0');
  return out;
}

export const advanceSeed = (seedHex: string): string =>
  createHash('sha256').update(seedHex).digest('hex');

export function shuffle<T>(items: T[], random: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
