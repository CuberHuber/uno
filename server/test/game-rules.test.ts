import { describe, expect, test } from 'vitest';
import { applyAction, createGame } from '../src/engine/game.js';
import { rng } from '../src/engine/deck.js';
import { card, fixedState } from './game-play.test.js';

const STACK = { stacking: true, forcePlay: false, drawToMatch: false, multiDiscard: false };
const FORCE = { stacking: false, forcePlay: true, drawToMatch: false, multiDiscard: false };

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

  test('a second draw2 stacks (pot 4); colour follows the answer card', () => {
    const d2a = card('red', 'draw2');
    const d2b = card('green', 'draw2');
    const s = fixedState(
      [[d2a, card('red', '1')], [d2b, card('green', '2')], [card('blue', '3')]],
      card('red', '7'), { rules: STACK });
    const r1 = applyAction(s, { type: 'play', seat: 0, cardId: d2a.id });
    if (!r1.ok) throw new Error(r1.error);
    const r2 = applyAction(r1.state, { type: 'play', seat: 1, cardId: d2b.id });
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.state.pendingDraw).toBe(4);
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

describe('strict stacking: +2 answers +2, +4 answers +4', () => {
  test('a wild4 may NOT answer a +2 pot', () => {
    const d2 = card('red', 'draw2');
    const w4 = card(null, 'wild4');
    const s = fixedState(
      [[d2, card('red', '1')], [w4, card('green', '2')], [card('blue', '3')]],
      card('red', '7'), { rules: STACK });
    const r1 = applyAction(s, { type: 'play', seat: 0, cardId: d2.id });
    if (!r1.ok) throw new Error(r1.error);
    const r2 = applyAction(r1.state, { type: 'play', seat: 1, cardId: w4.id, chosenColor: 'green' });
    expect(r2).toEqual({ ok: false, error: 'answer_pot' });
  });
  test('a draw2 may NOT answer a +4 pot', () => {
    const w4 = card(null, 'wild4');
    const d2 = card('blue', 'draw2');
    const s = fixedState(
      [[w4, card('red', '1')], [d2, card('green', '2')], [card('blue', '3')]],
      card('red', '7'), { rules: STACK });
    const r1 = applyAction(s, { type: 'play', seat: 0, cardId: w4.id, chosenColor: 'red' });
    if (!r1.ok) throw new Error(r1.error);
    expect(applyAction(r1.state, { type: 'play', seat: 1, cardId: d2.id }).ok).toBe(false);
  });
  test('kind resets when the pot is taken', () => {
    const d2 = card('red', 'draw2');
    const s = fixedState(
      [[d2, card('red', '1')], [card('green', '2')], [card('blue', '3')]],
      card('red', '7'), { rules: STACK });
    const r1 = applyAction(s, { type: 'play', seat: 0, cardId: d2.id });
    if (!r1.ok) throw new Error(r1.error);
    const r2 = applyAction(r1.state, { type: 'draw', seat: 1 });
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.state.pendingDrawKind).toBeNull();
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
