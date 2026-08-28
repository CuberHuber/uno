import type { Card, Color } from './types.js';

/** Number cards are the only ones a stack discard may combine, and the only ones
 *  allowed to open a round. One definition, both sides of the wire: the client
 *  used to carry its own copy of this regex. */
export const isNumberCard = (c: Card): boolean => /^\d$/.test(c.value);

export function isPlayable(card: Card, top: Card, currentColor: Color | null): boolean {
  if (card.value === 'wild' || card.value === 'wild4') return true;
  // A live round always has a colour — the opener is a coloured number card and
  // every wild names one. This stays as a guard because `Card.color` is nullable
  // in its own right (a wild has no colour of its own), not because any state
  // leaves the colour pending.
  if (currentColor === null) return true;
  if (card.color === currentColor) return true;
  return card.value === top.value;
}
