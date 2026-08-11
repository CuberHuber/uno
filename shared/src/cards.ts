import type { Card, Color } from './types.js';

export function isPlayable(card: Card, top: Card, currentColor: Color | null): boolean {
  if (card.value === 'wild' || card.value === 'wild4') return true;
  if (currentColor === null) return true; // pre-color-choice; server blocks plays until chosen
  if (card.color === currentColor) return true;
  return card.value === top.value;
}
