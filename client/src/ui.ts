// Small presentation helpers shared by the screens (palette + formatting).
import { RULES_CATALOG, type RuleInfo, type Rules } from '@uno/shared';
import type { Locale } from './i18n';

/** The house rules this table actually switched on, in catalog order; [] when classic.
 *  Every surface that explains the rules shows only these — a player whose host never
 *  turned on stacking should never have to read about pots. */
export const activeRules = (rules: Rules): RuleInfo[] => RULES_CATALOG.filter((r) => rules[r.id]);

/** Chip labels for the active rules, in the current locale; [] when classic. */
export const ruleChips = (rules: Rules, locale: Locale): string[] =>
  activeRules(rules).map((r) => r.title[locale]);

/** Per-seat avatar suits, in seating order — mirrors the prototype's player colors. */
const SEAT_SUITS = ['red', 'green', 'yellow', 'blue'] as const;
export const seatColor = (seat: number): string => `var(--card-${SEAT_SUITS[seat % 4]})`;

/** Room codes are 5 safe-alphabet chars — shown as-is. */
export const fmtCode = (code: string): string => code;

export const initialOf = (name: string | undefined): string => (name?.[0] ?? '?').toUpperCase();

/** Rounds already won across the table; the round in play is this + 1. */
export const roundsPlayed = (tally: number[]): number => tally.reduce((a, b) => a + b, 0);
