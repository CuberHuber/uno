// Small presentation helpers shared by the screens (palette + formatting).
import type { Rules } from '@uno/shared';

export const RULE_DEFS: readonly { key: keyof Rules; name: string; desc: string }[] = [
  { key: 'stacking', name: 'Stacking +2 / +4', desc: 'Pass the penalty along instead of drawing it.' },
  { key: 'forcePlay', name: 'Force play', desc: 'If a drawn card is playable, it goes down at once.' },
  { key: 'drawToMatch', name: 'Draw to match', desc: 'No play? Draw until something plays.' },
  { key: 'multiDiscard', name: 'Stack discard', desc: 'Same number, any colors — throw them together.' },
];

/** Chip labels for the active rules; classic when none are on. */
export const ruleChips = (rules: Rules): string[] => {
  const active = RULE_DEFS.filter((r) => rules[r.key]).map((r) => r.name);
  return active.length ? active : ['Classic rules'];
};

/** The host picks rules before taking a seat; they ride along in sessionStorage. */
export const rulesStashKey = (code: string): string => `ochre:rules:${code.toUpperCase()}`;

/** Per-seat avatar suits, in seating order — mirrors the prototype's player colors. */
const SEAT_SUITS = ['red', 'green', 'yellow', 'blue'] as const;
export const seatColor = (seat: number): string => `var(--card-${SEAT_SUITS[seat % 4]})`;

/** Room codes are 8 Crockford chars; render them XXXX-XXXX like the invites. */
export const fmtCode = (code: string): string =>
  code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

export const initialOf = (name: string | undefined): string => (name?.[0] ?? '?').toUpperCase();

/** Rounds already won across the table; the round in play is this + 1. */
export const roundsPlayed = (tally: number[]): number => tally.reduce((a, b) => a + b, 0);
