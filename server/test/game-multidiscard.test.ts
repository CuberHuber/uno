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
