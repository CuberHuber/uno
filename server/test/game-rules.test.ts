import { describe, expect, test } from 'vitest';
import { applyAction, createGame } from '../src/engine/game.js';
import { rng } from '../src/engine/deck.js';
import { card, fixedState } from './game-play.test.js';

const STACK = { stacking: true, forcePlay: false, multiPlay: false };
const FORCE = { stacking: false, forcePlay: true, multiPlay: false };
const MULTI = { stacking: false, forcePlay: false, multiPlay: true };

describe('house rule: stacking +2/+4', () => {
  test('draw2 defers the penalty: victim gets the turn owing 2, nothing drawn yet', () => {
    const d2 = card('red', 'draw2');
    const s = fixedState(
      [[d2, card('red', '1')], [card('green', '2')], [card('blue', '3')]],
      card('red', '7'), { rules: STACK });
    const r = applyAction(s, { type: 'play', seat: 0, cardId: d2.id });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.pendingDraw).toBe(2);
    expect(r.state.turn).toBe(1);
    expect(r.state.players[1]!.hand).toHaveLength(1);
  });

  test('victim stacks a draw2 of another colour; the pot grows to 4', () => {
    const d2a = card('red', 'draw2');
    const d2b = card('blue', 'draw2');
    const s = fixedState(
      [[d2a, card('red', '1')], [d2b, card('green', '2')], [card('blue', '3')]],
      card('red', '7'), { rules: STACK });
    const r1 = applyAction(s, { type: 'play', seat: 0, cardId: d2a.id });
    if (!r1.ok) throw new Error(r1.error);
    const r2 = applyAction(r1.state, { type: 'play', seat: 1, cardId: d2b.id });
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.state.pendingDraw).toBe(4);
    expect(r2.state.turn).toBe(2);
    expect(r2.state.currentColor).toBe('blue');
  });

  test('a wild4 stacks on a draw2 and sets the chosen colour (pot 6)', () => {
    const d2 = card('red', 'draw2');
    const w4 = card(null, 'wild4');
    const s = fixedState(
      [[d2, card('red', '1')], [w4, card('green', '2')], [card('blue', '3')]],
      card('red', '7'), { rules: STACK });
    const r1 = applyAction(s, { type: 'play', seat: 0, cardId: d2.id });
    if (!r1.ok) throw new Error(r1.error);
    const r2 = applyAction(r1.state, { type: 'play', seat: 1, cardId: w4.id, chosenColor: 'green' });
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.state.pendingDraw).toBe(6);
    expect(r2.state.turn).toBe(2);
    expect(r2.state.currentColor).toBe('green');
  });

  test('while owing, any non-+2/+4 play is rejected', () => {
    const d2 = card('red', 'draw2');
    const match = card('red', '9');
    const s = fixedState(
      [[d2, card('red', '1')], [match], [card('blue', '3')]],
      card('red', '7'), { rules: STACK });
    const r1 = applyAction(s, { type: 'play', seat: 0, cardId: d2.id });
    if (!r1.ok) throw new Error(r1.error);
    expect(applyAction(r1.state, { type: 'play', seat: 1, cardId: match.id }).ok).toBe(false);
  });

  test('drawing takes the whole pot, resets it, and passes the turn', () => {
    const d2 = card('red', 'draw2');
    const s = fixedState(
      [[d2, card('red', '1')], [card('green', '2')], [card('blue', '3')]],
      card('red', '7'), { rules: STACK });
    const r1 = applyAction(s, { type: 'play', seat: 0, cardId: d2.id });
    if (!r1.ok) throw new Error(r1.error);
    const r2 = applyAction(r1.state, { type: 'draw', seat: 1 });
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.state.players[1]!.hand).toHaveLength(3);
    expect(r2.state.pendingDraw).toBe(0);
    expect(r2.state.turn).toBe(2);
    expect(r2.state.pendingDrawn).toBeNull(); // no play-or-pass on penalty draws
    expect(r2.effects).toContainEqual({ type: 'drew', seat: 1, count: 2 });
  });

  test('without the rule the classic behaviour is unchanged', () => {
    const d2 = card('red', 'draw2');
    const s = fixedState(
      [[d2, card('red', '1')], [card('green', '2')], [card('blue', '3')]],
      card('red', '7'));
    const r = applyAction(s, { type: 'play', seat: 0, cardId: d2.id });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[1]!.hand).toHaveLength(3); // drew both at once
    expect(r.state.turn).toBe(2);                     // and was skipped
    expect(r.state.pendingDraw).toBe(0);
  });

  test('first flip draw2 with stacking: seat 0 owes 2 and keeps the turn', () => {
    let seed = -1;
    for (let i = 0; i < 10_000; i++) {
      if (createGame(2, rng(i), STACK).discard[0]!.value === 'draw2') { seed = i; break; }
    }
    expect(seed).toBeGreaterThanOrEqual(0);
    const g = createGame(2, rng(seed), STACK);
    expect(g.pendingDraw).toBe(2);
    expect(g.turn).toBe(0);
    expect(g.players[0]!.hand).toHaveLength(7); // nothing auto-drawn
  });
});

describe('house rule: force play', () => {
  test('a drawn playable non-wild goes down at once', () => {
    const drawn = card('red', '9');
    const s = fixedState([[card('blue', '1')], [card('green', '2')]], card('red', '7'), { rules: FORCE });
    s.drawPile = [drawn];
    const r = applyAction(s, { type: 'draw', seat: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.discard.at(-1)!.id).toBe(drawn.id);
    expect(r.state.players[0]!.hand).toHaveLength(1);
    expect(r.state.turn).toBe(1);
    expect(r.effects).toContainEqual({ type: 'drew', seat: 0, count: 1 });
    expect(r.effects).toContainEqual({ type: 'played', seat: 0, card: drawn });
  });

  test('a forced draw2 still lands its penalty on the next player', () => {
    const drawn = card('red', 'draw2');
    const s = fixedState(
      [[card('blue', '1')], [card('green', '2')], [card('yellow', '3')]],
      card('red', '7'), { rules: FORCE });
    s.drawPile = [card('green', '5'), card('green', '5'), drawn]; // pop() takes the draw2 first
    const r = applyAction(s, { type: 'draw', seat: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.discard.at(-1)!.id).toBe(drawn.id);
    expect(r.state.players[1]!.hand).toHaveLength(3); // classic penalty (no stacking)
    expect(r.state.turn).toBe(2);                     // victim skipped
  });

  test('a drawn wild waits for the colour: pending, pass refused, play works', () => {
    const drawn = card(null, 'wild');
    const s = fixedState([[card('blue', '1')], [card('green', '2')]], card('red', '7'), { rules: FORCE });
    s.drawPile = [drawn];
    const r = applyAction(s, { type: 'draw', seat: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.pendingDrawn).toEqual({ seat: 0, cardId: drawn.id });
    expect(applyAction(r.state, { type: 'pass', seat: 0 }).ok).toBe(false);
    const played = applyAction(r.state, { type: 'play', seat: 0, cardId: drawn.id, chosenColor: 'blue' });
    if (!played.ok) throw new Error(played.error);
    expect(played.state.currentColor).toBe('blue');
    expect(played.state.turn).toBe(1);
  });

  test('a drawn unplayable card still passes the turn', () => {
    const s = fixedState([[card('red', '1')], [card('green', '2')]], card('red', '7'), { rules: FORCE });
    s.drawPile = [card('blue', '3')];
    const r = applyAction(s, { type: 'draw', seat: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.turn).toBe(1);
    expect(r.state.pendingDrawn).toBeNull();
  });
});

describe('house rule: play a whole rank', () => {
  test('the whole set goes down; the last card left face up sets the colour', () => {
    const red7 = card('red', '7');
    const blue7 = card('blue', '7');
    const s = fixedState(
      [[red7, blue7, card('green', '1')], [card('green', '2')], [card('blue', '3')]],
      card('red', '9'), { rules: MULTI });
    const r = applyAction(s, { type: 'play', seat: 0, cardId: red7.id, extraCardIds: [blue7.id] });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[0]!.hand).toHaveLength(1);
    expect(r.state.discard.at(-1)!.id).toBe(blue7.id);
    expect(r.state.currentColor).toBe('blue'); // blue 7 was illegal alone — it rides the red 7
    expect(r.state.turn).toBe(1);
    expect(r.effects).toContainEqual({ type: 'played', seat: 0, card: red7 });
    expect(r.effects).toContainEqual({ type: 'played', seat: 0, card: blue7 });
  });

  test('cards of another rank cannot ride along', () => {
    const red7 = card('red', '7');
    const red8 = card('red', '8');
    const s = fixedState([[red7, red8], [card('green', '2')]], card('red', '9'), { rules: MULTI });
    expect(applyAction(s, { type: 'play', seat: 0, cardId: red7.id, extraCardIds: [red8.id] }).ok).toBe(false);
  });

  test('an illegal lead is still refused, set or no set', () => {
    const blue7a = card('blue', '7');
    const blue7b = card('blue', '7');
    const s = fixedState([[blue7a, blue7b], [card('green', '2')]], card('red', '9'), { rules: MULTI });
    expect(applyAction(s, { type: 'play', seat: 0, cardId: blue7a.id, extraCardIds: [blue7b.id] }).ok).toBe(false);
  });

  test('without the rule extras are refused', () => {
    const red7 = card('red', '7');
    const blue7 = card('blue', '7');
    const s = fixedState([[red7, blue7], [card('green', '2')]], card('red', '9'));
    const r = applyAction(s, { type: 'play', seat: 0, cardId: red7.id, extraCardIds: [blue7.id] });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected a refusal');
    expect(r.error).toBe('one card per turn');
  });

  test('a card cannot be laid twice, and unheld cards are refused', () => {
    const red7 = card('red', '7');
    const s = fixedState([[red7, card('blue', '7')], [card('green', '2')]], card('red', '9'), { rules: MULTI });
    expect(applyAction(s, { type: 'play', seat: 0, cardId: red7.id, extraCardIds: [red7.id] }).ok).toBe(false);
    expect(applyAction(s, { type: 'play', seat: 0, cardId: red7.id, extraCardIds: [99999] }).ok).toBe(false);
  });

  test('two skips walk one seat further than one', () => {
    const s1 = card('red', 'skip');
    const s2 = card('blue', 'skip');
    const s = fixedState(
      [[s1, s2, card('green', '1')], [card('green', '2')], [card('blue', '3')], [card('yellow', '4')]],
      card('red', '9'), { rules: MULTI });
    const r = applyAction(s, { type: 'play', seat: 0, cardId: s1.id, extraCardIds: [s2.id] });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.turn).toBe(3); // seats 1 and 2 both skipped
  });

  test('two +2s land four cards on the next player, who is still skipped', () => {
    const d2a = card('red', 'draw2');
    const d2b = card('blue', 'draw2');
    const s = fixedState(
      [[d2a, d2b, card('green', '1')], [card('green', '2')], [card('blue', '3')]],
      card('red', '9'), { rules: MULTI });
    const r = applyAction(s, { type: 'play', seat: 0, cardId: d2a.id, extraCardIds: [d2b.id] });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[1]!.hand).toHaveLength(5);
    expect(r.effects).toContainEqual({ type: 'drew', seat: 1, count: 4 });
    expect(r.state.turn).toBe(2);
  });

  test('with stacking on, a pair of +2s builds a pot of 4', () => {
    const d2a = card('red', 'draw2');
    const d2b = card('blue', 'draw2');
    const s = fixedState(
      [[d2a, d2b, card('green', '1')], [card('green', '2')], [card('blue', '3')]],
      card('red', '9'), { rules: { ...MULTI, stacking: true } });
    const r = applyAction(s, { type: 'play', seat: 0, cardId: d2a.id, extraCardIds: [d2b.id] });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.pendingDraw).toBe(4);
    expect(r.state.players[1]!.hand).toHaveLength(1);
    expect(r.state.turn).toBe(1);
  });

  test('an even number of reverses leaves the direction alone', () => {
    const r1 = card('red', 'reverse');
    const r2 = card('blue', 'reverse');
    const s = fixedState(
      [[r1, r2, card('green', '1')], [card('green', '2')], [card('blue', '3')]],
      card('red', '9'), { rules: MULTI });
    const r = applyAction(s, { type: 'play', seat: 0, cardId: r1.id, extraCardIds: [r2.id] });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.direction).toBe(1);
    expect(r.state.turn).toBe(1);
  });

  test('head to head, a pair of reverses chains two skips and hands the turn over', () => {
    const r1 = card('red', 'reverse');
    const r2 = card('blue', 'reverse');
    const s = fixedState([[r1, r2, card('green', '1')], [card('green', '2')]], card('red', '9'), { rules: MULTI });
    const one = applyAction(s, { type: 'play', seat: 0, cardId: r1.id });
    if (!one.ok) throw new Error(one.error);
    expect(one.state.turn).toBe(0); // a single reverse still bounces back to you
    const two = applyAction(s, { type: 'play', seat: 0, cardId: r1.id, extraCardIds: [r2.id] });
    if (!two.ok) throw new Error(two.error);
    expect(two.state.turn).toBe(1); // the second skip lands on the opponent
  });

  test('two wilds go down on one chosen colour', () => {
    const w1 = card(null, 'wild');
    const w2 = card(null, 'wild');
    const s = fixedState([[w1, w2, card('green', '1')], [card('green', '2')]], card('red', '9'), { rules: MULTI });
    const r = applyAction(s, { type: 'play', seat: 0, cardId: w1.id, extraCardIds: [w2.id], chosenColor: 'green' });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.currentColor).toBe('green');
    expect(r.state.players[0]!.hand).toHaveLength(1);
  });

  test('emptying the hand with a set wins the round', () => {
    const red7 = card('red', '7');
    const blue7 = card('blue', '7');
    const s = fixedState([[red7, blue7], [card('green', '2')]], card('red', '9'), { rules: MULTI });
    const r = applyAction(s, { type: 'play', seat: 0, cardId: red7.id, extraCardIds: [blue7.id] });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.winner).toBe(0);
    expect(r.effects).toContainEqual({ type: 'win', seat: 0 });
  });

  test('a set that leaves one card still opens the catch window', () => {
    const red7 = card('red', '7');
    const blue7 = card('blue', '7');
    const s = fixedState(
      [[red7, blue7, card('green', '1')], [card('green', '2')]],
      card('red', '9'), { rules: MULTI });
    const r = applyAction(s, { type: 'play', seat: 0, cardId: red7.id, extraCardIds: [blue7.id] });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.catchWindow).toEqual({ seat: 0 });
  });
});
