import { describe, expect, test } from 'vitest';
import { applyAction } from '../src/engine/game.js';
import { card, fixedState } from './game-play.test.js';

describe('wilds', () => {
  test('wild requires a chosen color and sets it', () => {
    const w = card(null, 'wild');
    const s = fixedState([[w, card('red', '1')], [card('green', '2')]], card('red', '7'));
    expect(applyAction(s, { type: 'play', seat: 0, cardId: w.id }).ok).toBe(false);
    const r = applyAction(s, { type: 'play', seat: 0, cardId: w.id, chosenColor: 'green' });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.currentColor).toBe('green');
    expect(r.state.turn).toBe(1);
  });
  test('wild4: victim draws 4 and is skipped (no challenge)', () => {
    const w = card(null, 'wild4');
    const s = fixedState([[w, card('red', '1')], [card('green', '2')], [card('blue', '2')]], card('red', '7'));
    const r = applyAction(s, { type: 'play', seat: 0, cardId: w.id, chosenColor: 'blue' });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[1]!.hand).toHaveLength(5);
    expect(r.state.turn).toBe(2);
    expect(r.state.currentColor).toBe('blue');
  });
});

describe('chooseColor (first-flip wild)', () => {
  test('resolves the pending choice; plays are blocked until then', () => {
    const c0 = card('red', '1');
    const s = fixedState([[c0], [card('green', '2')]], card(null, 'wild'), {
      currentColor: null, mustChooseColor: true,
    });
    expect(applyAction(s, { type: 'play', seat: 0, cardId: c0.id }).ok).toBe(false);
    const r = applyAction(s, { type: 'chooseColor', seat: 0, color: 'red' });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.currentColor).toBe('red');
    expect(r.state.mustChooseColor).toBe(false);
    expect(applyAction(r.state, { type: 'play', seat: 0, cardId: c0.id }).ok).toBe(true);
  });
  test('only the turn player may choose', () => {
    const s = fixedState([[card('red', '1')], [card('green', '2')]], card(null, 'wild'), {
      currentColor: null, mustChooseColor: true,
    });
    expect(applyAction(s, { type: 'chooseColor', seat: 1, color: 'red' }).ok).toBe(false);
  });
});
