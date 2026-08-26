import { describe, expect, test } from 'vitest';
import { applyAction } from '../src/engine/game.js';
import { card, fixedState } from './game-play.test.js';

describe('draw', () => {
  test('unplayable drawn card: hand grows by one, turn advances', () => {
    const s = fixedState([[card('red', '1')], [card('green', '2')]], card('red', '7'));
    s.drawPile = [card('blue', '3')]; // blue 3 does not match red 7 / color red
    const r = applyAction(s, { type: 'draw', seat: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[0]!.hand).toHaveLength(2);
    expect(r.state.turn).toBe(1);
    expect(r.state.pendingDrawn).toBeNull();
    expect(r.effects).toContainEqual({ type: 'drew', seat: 0, count: 1 });
  });

  test('playable drawn card: pendingDrawn set, turn stays', () => {
    const drawnCard = card('red', '9');
    const s = fixedState([[card('blue', '1')], [card('green', '2')]], card('red', '7'));
    s.drawPile = [drawnCard];
    const r = applyAction(s, { type: 'draw', seat: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.pendingDrawn).toEqual({ seat: 0, cardId: drawnCard.id });
    expect(r.state.turn).toBe(0);
  });

  test('with pendingDrawn: playing another card is rejected, playing the drawn card works', () => {
    const drawnCard = card('red', '9');
    const other = card('red', '1');
    const s = fixedState([[other], [card('green', '2')]], card('red', '7'));
    s.drawPile = [drawnCard];
    const afterDraw = applyAction(s, { type: 'draw', seat: 0 });
    if (!afterDraw.ok) throw new Error(afterDraw.error);
    expect(applyAction(afterDraw.state, { type: 'play', seat: 0, cardIds: [other.id] }).ok).toBe(false);
    const played = applyAction(afterDraw.state, { type: 'play', seat: 0, cardIds: [drawnCard.id] });
    if (!played.ok) throw new Error(played.error);
    expect(played.state.discard.at(-1)!.id).toBe(drawnCard.id);
  });

  test('pass: keeps the drawn card and advances the turn', () => {
    const s = fixedState([[card('blue', '1')], [card('green', '2')]], card('red', '7'));
    s.drawPile = [card('red', '9')];
    const afterDraw = applyAction(s, { type: 'draw', seat: 0 });
    if (!afterDraw.ok) throw new Error(afterDraw.error);
    const r = applyAction(afterDraw.state, { type: 'pass', seat: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[0]!.hand).toHaveLength(2);
    expect(r.state.turn).toBe(1);
    expect(r.state.pendingDrawn).toBeNull();
  });

  test('pass closes an open catch window, like every other act', () => {
    const drawn = card('red', '9');
    const s = fixedState([[card('blue', '1'), drawn], [card('green', '2')]], card('red', '7'), {
      pendingDrawn: { seat: 0, cardId: drawn.id }, catchWindow: { seat: 1 },
    });
    const r = applyAction(s, { type: 'pass', seat: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.catchWindow).toBeNull();
    expect(r.state.turn).toBe(1);
  });

  test('pass without a pending drawn card is rejected', () => {
    const s = fixedState([[card('red', '1')], [card('green', '2')]], card('red', '7'));
    expect(applyAction(s, { type: 'pass', seat: 0 }).ok).toBe(false);
  });

  test('empty draw pile: discard minus top is reshuffled into it', () => {
    const buried = [card('yellow', '4'), card('yellow', '6')];
    const top = card('red', '7');
    const s = fixedState([[card('blue', '1')], [card('green', '2')]], top);
    s.drawPile = [];
    s.discard = [...buried, top];
    const r = applyAction(s, { type: 'draw', seat: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[0]!.hand).toHaveLength(2);
    expect(r.state.discard).toEqual([top]);
    expect(r.state.drawPile.length).toBe(1); // 2 buried − 1 drawn
  });

  test('both piles dry: draw becomes a pass', () => {
    const s = fixedState([[card('blue', '1')], [card('green', '2')]], card('red', '7'));
    s.drawPile = [];
    s.discard = [card('red', '7')];
    const r = applyAction(s, { type: 'draw', seat: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[0]!.hand).toHaveLength(1);
    expect(r.state.turn).toBe(1);
  });
});
