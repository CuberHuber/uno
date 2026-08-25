import { describe, expect, test } from 'vitest';
import { applyAction } from '../src/engine/game.js';
import { card, fixedState } from './game-play.test.js';

const MULTI = { stacking: false, forcePlay: false, drawToMatch: false, multiDiscard: true };
const CLASSIC = { ...MULTI, multiDiscard: false };

describe('house rule: stack discard (same-value numbers)', () => {
  test('three fives go down together; the last one sets the color', () => {
    const b5 = card('blue', '5'); const r5 = card('red', '5'); const g5 = card('green', '5');
    const s = fixedState(
      [[b5, r5, g5, card('yellow', '1')], [card('green', '2')], [card('blue', '3')]],
      card('blue', '7'), { rules: MULTI });
    const r = applyAction(s, { type: 'play', seat: 0, cardIds: [b5.id, r5.id, g5.id] });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[0]!.hand).toHaveLength(1);
    expect(r.state.discard.slice(-3).map((c) => c.id)).toEqual([b5.id, r5.id, g5.id]);
    expect(r.state.currentColor).toBe('green');
    expect(r.state.turn).toBe(1);
    expect(r.effects).toContainEqual({ type: 'played', seat: 0, cards: [b5, r5, g5] });
  });
  test('a stack removes exactly the played cards, never the last card in hand', () => {
    const b5 = card('blue', '5'); const r5 = card('red', '5');
    const keep = card('yellow', '1'); const alsoKeep = card('green', '9');
    const s = fixedState(
      [[b5, r5, keep, alsoKeep], [card('green', '2')]],
      card('blue', '7'), { rules: MULTI });
    const r = applyAction(s, { type: 'play', seat: 0, cardIds: [b5.id, r5.id] });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[0]!.hand.map((c) => c.id)).toEqual([keep.id, alsoKeep.id]);
  });

  test('first card must be playable', () => {
    const r5 = card('red', '5'); const g5 = card('green', '5');
    const s = fixedState(
      [[r5, g5, card('blue', '1')], [card('green', '2')]],
      card('blue', '7'), { rules: MULTI });
    expect(applyAction(s, { type: 'play', seat: 0, cardIds: [r5.id, g5.id] }).ok).toBe(false);
  });
  test('mixed values and action cards are rejected as bad_stack', () => {
    const b5 = card('blue', '5'); const b6 = card('blue', '6');
    const sk = card('blue', 'skip'); const sk2 = card('red', 'skip');
    const s = fixedState(
      [[b5, b6, sk, sk2], [card('green', '2')]],
      card('blue', '7'), { rules: MULTI });
    expect(applyAction(s, { type: 'play', seat: 0, cardIds: [b5.id, b6.id] }))
      .toEqual({ ok: false, error: 'bad_stack' });
    expect(applyAction(s, { type: 'play', seat: 0, cardIds: [sk.id, sk2.id] }))
      .toEqual({ ok: false, error: 'bad_stack' });
  });
  test('with the rule off, two cards are rejected', () => {
    const b5 = card('blue', '5'); const r5 = card('red', '5');
    const s = fixedState([[b5, r5], [card('green', '2')]], card('blue', '7'), { rules: CLASSIC });
    expect(applyAction(s, { type: 'play', seat: 0, cardIds: [b5.id, r5.id] }))
      .toEqual({ ok: false, error: 'bad_stack' });
  });
  test('emptying the hand with a stack wins the round', () => {
    const b5 = card('blue', '5'); const r5 = card('red', '5');
    const s = fixedState([[b5, r5], [card('green', '2')]], card('blue', '7'), { rules: MULTI });
    const r = applyAction(s, { type: 'play', seat: 0, cardIds: [b5.id, r5.id] });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.winner).toBe(0);
  });
  test('one card left after a stack arms the catch window', () => {
    const b5 = card('blue', '5'); const r5 = card('red', '5');
    const s = fixedState(
      [[b5, r5, card('yellow', '9')], [card('green', '2')]],
      card('blue', '7'), { rules: MULTI });
    const r = applyAction(s, { type: 'play', seat: 0, cardIds: [b5.id, r5.id] });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.catchWindow).toEqual({ seat: 0 });
  });
  test('duplicate ids in one stack are rejected', () => {
    const b5 = card('blue', '5');
    const s = fixedState([[b5, card('red', '5')], [card('green', '2')]], card('blue', '7'), { rules: MULTI });
    expect(applyAction(s, { type: 'play', seat: 0, cardIds: [b5.id, b5.id] }).ok).toBe(false);
  });
});

describe('house rule: stack discard after a draw', () => {
  const FORCE_MULTI = { ...MULTI, forcePlay: true };

  /** Seat 0 holds two off-colour fives and one dead card; the pile's next card is
   *  a playable blue five, so drawing it opens a stack of three. */
  const drawnFiveState = (rules = MULTI) => {
    const b5 = card('blue', '5'); const r5 = card('red', '5'); const g5 = card('green', '5');
    const dead = card('yellow', '1');
    const s = fixedState([[r5, g5, dead], [card('green', '2')]], card('blue', '7'),
      { rules, drawPile: [card('yellow', '9'), b5] });
    return { s, b5, r5, g5, dead };
  };

  test('the drawn card goes down together with the rest of its rank', () => {
    const { s, b5, r5, g5, dead } = drawnFiveState();
    const drew = applyAction(s, { type: 'draw', seat: 0 });
    if (!drew.ok) throw new Error(drew.error);
    expect(drew.state.pendingDrawn).toEqual({ seat: 0, cardId: b5.id });

    const r = applyAction(drew.state, { type: 'play', seat: 0, cardIds: [b5.id, r5.id, g5.id] });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[0]!.hand.map((c) => c.id)).toEqual([dead.id]);
    expect(r.state.discard.slice(-3).map((c) => c.id)).toEqual([b5.id, r5.id, g5.id]);
    expect(r.state.currentColor).toBe('green');
    expect(r.state.pendingDrawn).toBeNull();
    expect(r.state.turn).toBe(1);
  });

  test('a stack that leaves the drawn card out is still refused', () => {
    const { s, r5, g5 } = drawnFiveState();
    const drew = applyAction(s, { type: 'draw', seat: 0 });
    if (!drew.ok) throw new Error(drew.error);
    expect(applyAction(drew.state, { type: 'play', seat: 0, cardIds: [r5.id, g5.id] }))
      .toEqual({ ok: false, error: 'play_drawn_or_pass' });
  });

  test('force play leaves the choice open when the drawn card has rank mates', () => {
    const { s, b5, r5, g5 } = drawnFiveState(FORCE_MULTI);
    const drew = applyAction(s, { type: 'draw', seat: 0 });
    if (!drew.ok) throw new Error(drew.error);
    // Not slammed down as a single card: the stack is still the player's to size.
    expect(drew.state.discard).toHaveLength(1);
    expect(drew.state.turn).toBe(0);
    expect(drew.state.pendingDrawn).toEqual({ seat: 0, cardId: b5.id });
    // Force play still forbids walking away from it.
    expect(applyAction(drew.state, { type: 'pass', seat: 0 }))
      .toEqual({ ok: false, error: 'force_play' });
    expect(applyAction(drew.state, { type: 'play', seat: 0, cardIds: [b5.id, r5.id, g5.id] }).ok).toBe(true);
  });

  test('force play still auto-plays a drawn card with no rank mates', () => {
    const b5 = card('blue', '5');
    const s = fixedState([[card('yellow', '1'), card('red', '9')], [card('green', '2')]],
      card('blue', '7'), { rules: FORCE_MULTI, drawPile: [card('yellow', '9'), b5] });
    const r = applyAction(s, { type: 'draw', seat: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.discard.at(-1)!.id).toBe(b5.id);
    expect(r.state.pendingDrawn).toBeNull();
    expect(r.state.turn).toBe(1);
  });
});
