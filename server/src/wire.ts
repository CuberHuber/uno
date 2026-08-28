import type { Color, Rules } from '@uno/shared';

/** The wire boundary. Socket.IO hands a handler exactly the argument array the
 *  client sent — no shape, no types, and no ack function unless the client
 *  passed a callback — so every field arrives as `unknown` until a guard proves
 *  otherwise. Guards never coerce: coercion is what walks `'__proto__'` and
 *  `'1'` past the seat checks downstream, and `RegExp.test`, `Number()` and
 *  `+v` all coerce. Parsers are total — they return a refusal, never throw. */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const bad = (error: string): Parsed<never> => ({ ok: false, error });

/** Refusals reuse the codes the client already translates; `bad_request` is the
 *  single addition, and only a hand-made frame can ever reach it. */
export const BAD_REQUEST = 'bad_request';

const COLORS = ['red', 'yellow', 'green', 'blue'] as const;

export const MAX_CODE_LEN = 32;  // real codes are 5 chars; slack for spaces and dashes
export const MAX_NAME_LEN = 64;  // the store trims to 24 anyway
export const MAX_TOKEN_LEN = 64; // real tokens are 32 hex chars
export const MAX_PIN_LEN = 8;    // real pins are 4 digits
export const MAX_CARD_IDS = 16;  // one deck tops a same-value stack out at 8
export const MAX_SEAT = 15;      // tables hold 4; the slack outlives the constant

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

export const isColor = (v: unknown): v is Color =>
  typeof v === 'string' && (COLORS as readonly string[]).includes(v);

/** A seat indexes an array, so nothing but a real index will do:
 *  `Number.isSafeInteger` turns away `'1'`, `'__proto__'`, `'length'`, `1.5`,
 *  `NaN` and `2 ** 53` without touching the value. */
export const isSeat = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= MAX_SEAT;

export const isCardId = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;

/** A journal number is a counter rather than an index, but it is compared and
 *  it is arithmetic, and that is enough: `'1' > 0` passes, `Math.max(cursor,
 *  '__proto__')` is `NaN`, `1.5` would wedge a pointer between two
 *  transactions, and `2 ** 53` sits where integers stop being distinct.
 *  `Number.isSafeInteger` turns every one of them away without coercing — and
 *  it rejects `2 ** 53` itself, so no bound of our own is needed. */
export const isSeq = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;

/** The room store's own normalisation, repeated here so the code a socket holds
 *  and the code it re-joins with compare as plain equal strings. */
export const normCode = (code: string): string => code.toUpperCase().replace(/[\s-]/g, '');

export interface JoinFields { code: string; name: string; token?: string; pin?: string }

export const parseJoin = (p: unknown): Parsed<JoinFields> => {
  if (!isRecord(p)) return bad(BAD_REQUEST);
  const { code, name, token, pin } = p;
  if (!isStr(code, MAX_CODE_LEN) || code.length === 0) return bad('table_not_found');
  if (name !== undefined && name !== null && !isStr(name, MAX_NAME_LEN)) return bad(BAD_REQUEST);
  if (token !== undefined && token !== null && !isStr(token, MAX_TOKEN_LEN)) return bad(BAD_REQUEST);
  if (pin !== undefined && pin !== null && !isStr(pin, MAX_PIN_LEN)) return bad('bad_pin');
  const fields: JoinFields = {
    code: normCode(code),
    name: typeof name === 'string' ? name : 'Player',
  };
  if (typeof token === 'string' && token.length > 0) fields.token = token;
  // An absent PIN and an empty one differ: the store answers `pin_required`
  // only for the absent case, and the join screen keys its prompt on that.
  if (typeof pin === 'string') fields.pin = pin;
  return ok(fields);
};

export const parseRules = (p: unknown): Parsed<{ rules: Rules }> => {
  if (!isRecord(p) || !isRecord(p.rules)) return bad(BAD_REQUEST);
  const r = p.rules;
  // Four booleans and nothing else: a malformed frame must not be able to
  // smuggle a field into the room's rules, nor silently reset them.
  return ok({
    rules: {
      stacking: !!r.stacking, forcePlay: !!r.forcePlay,
      drawToMatch: !!r.drawToMatch, multiDiscard: !!r.multiDiscard,
    },
  });
};

export const parsePin = (p: unknown): Parsed<{ pin: string | null }> => {
  if (!isRecord(p)) return bad(BAD_REQUEST);
  const { pin } = p;
  if (pin === null) return ok({ pin: null });
  if (!isStr(pin, MAX_PIN_LEN)) return bad('bad_pin');
  return ok({ pin }); // the four digits are the store's rule to enforce
};

export interface PlayFields { cardIds: number[]; chosenColor?: Color }

export const parsePlay = (p: unknown): Parsed<PlayFields> => {
  if (!isRecord(p)) return bad(BAD_REQUEST);
  const { cardIds, chosenColor } = p;
  if (!Array.isArray(cardIds) || cardIds.length === 0 || cardIds.length > MAX_CARD_IDS) {
    return bad('bad_stack');
  }
  if (!cardIds.every(isCardId)) return bad('bad_stack');
  if (chosenColor !== undefined && chosenColor !== null && !isColor(chosenColor)) {
    return bad('wild_needs_color');
  }
  // A copy, so nothing downstream reads an array the deserialiser still owns.
  const fields: PlayFields = { cardIds: [...cardIds] as number[] };
  if (isColor(chosenColor)) fields.chosenColor = chosenColor;
  return ok(fields);
};

export const parseSeat = (p: unknown): Parsed<{ seat: number }> => {
  if (!isRecord(p) || !isSeat(p.seat)) return bad('no_such_seat');
  return ok({ seat: p.seat });
};

/** The acknowledgement of a journal number. `bad_request` and not a code of its
 *  own: a real client never sends anything else here, because the only numbers
 *  it ever acknowledges are ones the server just handed it. */
export const parseAck = (p: unknown): Parsed<{ seq: number }> => {
  if (!isRecord(p) || !isSeq(p.seq)) return bad(BAD_REQUEST);
  return ok({ seq: p.seq });
};

/** Events that carry nothing still go through the same path, so the seat check
 *  and the action budget stay in one place. */
export const parseNone = (): Parsed<null> => ok(null);
