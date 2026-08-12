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

/** English rendering of the server's snake_case rejection codes
 *  (proper ru/en dictionaries arrive with the i18n sub-project). */
const ERR_TEXT: Record<string, string> = {
  round_over: 'The round is over',
  bad_seat: 'Bad seat',
  no_color_pending: 'No colour choice pending',
  play_drawn_or_pass: 'Play the drawn card or end your turn',
  card_not_in_hand: 'That card is not in your hand',
  answer_pot: 'Answer the penalty or take it',
  card_no_match: 'That card does not match',
  wild_needs_color: 'Pick a colour for the wild',
  not_your_turn: 'Not your turn',
  choose_color_first: 'Choose a colour first',
  nothing_to_pass: 'Nothing to pass',
  force_play: 'Force play — the drawn card goes down',
  cannot_call_now: 'You can’t call now',
  nothing_to_catch: 'Nothing to catch',
  cannot_catch_self: 'You can’t catch yourself',
  table_not_found: 'Table not found',
  game_started: 'The game already started',
  table_full: 'The table is full',
  seat_not_found: 'Seat not found',
  host_only_rules: 'Only the host changes this',
  rules_locked: 'Locked once the game starts',
  host_only_deal: 'Only the host can deal',
  already_dealt: 'Already dealt',
  need_two_players: 'You need at least two players',
  no_round: 'No round in progress',
  round_running: 'The round is still running',
  not_enough_players: 'Not enough players',
  no_such_seat: 'No such seat',
  player_connected: 'That player is connected',
  grace_running: 'Give them a moment — the grace period is running',
  bad_stack: 'Those cards can’t go down together',
};
export const errText = (code: string): string => ERR_TEXT[code] ?? code;
