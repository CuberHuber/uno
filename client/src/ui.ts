// Small presentation helpers shared by the screens (palette + formatting).

/** Per-seat avatar suits, in seating order — mirrors the prototype's player colors. */
const SEAT_SUITS = ['red', 'green', 'yellow', 'blue'] as const;
export const seatColor = (seat: number): string => `var(--card-${SEAT_SUITS[seat % 4]})`;

/** Room codes are 8 Crockford chars; render them XXXX-XXXX like the invites. */
export const fmtCode = (code: string): string =>
  code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

export const initialOf = (name: string | undefined): string => (name?.[0] ?? '?').toUpperCase();

/** Rounds already won across the table; the round in play is this + 1. */
export const roundsPlayed = (tally: number[]): number => tally.reduce((a, b) => a + b, 0);
