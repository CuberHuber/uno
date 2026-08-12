import { describe, expect, test } from 'vitest';
import { applyAction } from '../src/engine/game.js';
import { card, fixedState } from './game-play.test.js';

const DTM = { stacking: false, forcePlay: false, drawToMatch: true, multiDiscard: false };
const DTM_FORCE = { ...DTM, forcePlay: true };

describe('house rule: draw to match', () => {
  test('draws past unplayable cards and stops at the first playable', () => {
    const s = fixedState([[card('blue', '1')], [card('green', '2')]], card('red', '7'), { rules: DTM });
    const hit = card('red', '9');
    s.drawPile = [hit, card('green', '4'), card('blue', '3')]; // pop() order: blue3, green4, red9
    const r = applyAction(s, { type: 'draw', seat: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[0]!.hand).toHaveLength(4); // 1 + 3 drawn
    expect(r.effects).toContainEqual({ type: 'drew', seat: 0, count: 3 });
    expect(r.state.pendingDrawn).toEqual({ seat: 0, cardId: hit.id }); // play-or-pass (forcePlay off)
    expect(r.state.turn).toBe(0);
  });
  test('with forcePlay the found card goes straight down', () => {
    const s = fixedState([[card('blue', '1')], [card('green', '2')]], card('red', '7'), { rules: DTM_FORCE });
    const hit = card('red', '9');
    s.drawPile = [hit, card('blue', '3')];
    const r = applyAction(s, { type: 'draw', seat: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.discard.at(-1)!.id).toBe(hit.id);
    expect(r.state.turn).toBe(1);
  });
  test('penalty pots still draw exact counts', () => {
    const d2 = card('red', 'draw2');
    const s = fixedState(
      [[d2, card('red', '1')], [card('green', '2')], [card('blue', '3')]],
      card('red', '7'), { rules: { ...DTM, stacking: true } });
    const r1 = applyAction(s, { type: 'play', seat: 0, cardIds: [d2.id] });
    if (!r1.ok) throw new Error(r1.error);
    const r2 = applyAction(r1.state, { type: 'draw', seat: 1 });
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.state.players[1]!.hand).toHaveLength(3); // exactly 2 drawn, no draw-to-match
  });
  test('both piles dry: drawing stops and the turn passes', () => {
    const s = fixedState([[card('blue', '1')], [card('green', '2')]], card('red', '7'), { rules: DTM });
    s.drawPile = [card('blue', '3')]; // one unplayable card, then nothing (discard has only its top)
    const r = applyAction(s, { type: 'draw', seat: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[0]!.hand).toHaveLength(2);
    expect(r.state.turn).toBe(1);
    expect(r.state.pendingDrawn).toBeNull();
  });
});
