import { describe, expect, test } from 'vitest';
import type { Color } from '@uno/shared';
import { applyAction } from '../src/engine/game.js';
import { card, fixedState } from './game-play.test.js';

const asColor = (v: unknown) => v as Color;

describe('wilds', () => {
  test('wild requires a chosen color and sets it', () => {
    const w = card(null, 'wild');
    const s = fixedState([[w, card('red', '1')], [card('green', '2')]], card('red', '7'));
    expect(applyAction(s, { type: 'play', seat: 0, cardIds: [w.id] }).ok).toBe(false);
    const r = applyAction(s, { type: 'play', seat: 0, cardIds: [w.id], chosenColor: 'green' });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.currentColor).toBe('green');
    expect(r.state.turn).toBe(1);
  });
  test('wild4: victim draws 4 and is skipped (no challenge)', () => {
    const w = card(null, 'wild4');
    const s = fixedState([[w, card('red', '1')], [card('green', '2')], [card('blue', '2')]], card('red', '7'));
    const r = applyAction(s, { type: 'play', seat: 0, cardIds: [w.id], chosenColor: 'blue' });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[1]!.hand).toHaveLength(5);
    expect(r.state.turn).toBe(2);
    expect(r.state.currentColor).toBe('blue');
  });
});

describe('wilds — the chosen colour is checked, not trusted', () => {
  const bad = ['purple', 'RED', 'Red', '', 'red ', 0, 1, null, {}, ['red']];
  test('a colour outside the four is rejected and changes nothing', () => {
    const w = card(null, 'wild');
    const s = fixedState([[w, card('red', '1')], [card('green', '2')]], card('red', '7'));
    const before = JSON.stringify(s);
    for (const v of bad) {
      const r = applyAction(s, { type: 'play', seat: 0, cardIds: [w.id], chosenColor: asColor(v) });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('wild_needs_color');
    }
    expect(JSON.stringify(s)).toBe(before);
  });
  test('wild4 is checked the same way', () => {
    const w = card(null, 'wild4');
    const s = fixedState([[w, card('red', '1')], [card('green', '2')]], card('red', '7'));
    const r = applyAction(s, { type: 'play', seat: 0, cardIds: [w.id], chosenColor: asColor('purple') });
    expect(r.ok).toBe(false);
  });
  test('a bogus colour never becomes the round colour: coloured cards stay playable', () => {
    const w = card(null, 'wild');
    const keep = card('red', '1');
    const s = fixedState([[w, keep], [card('green', '2')]], card('red', '7'));
    expect(applyAction(s, { type: 'play', seat: 0, cardIds: [w.id], chosenColor: asColor('purple') }).ok).toBe(false);
    expect(s.currentColor).toBe('red');
    expect(applyAction(s, { type: 'play', seat: 0, cardIds: [keep.id] }).ok).toBe(true);
  });
  test('a bogus colour cannot turn the drawToMatch loop into a deck-emptying draw', () => {
    const w = card(null, 'wild');
    const s = fixedState([[w, card('red', '1')], [card('green', '2')]], card('red', '7'), {
      rules: { stacking: false, forcePlay: false, drawToMatch: true, multiDiscard: false },
    });
    s.drawPile = [card('green', '5'), card('green', '5'), card('red', '3'), card('green', '5'), card('green', '5')];
    expect(applyAction(s, { type: 'play', seat: 0, cardIds: [w.id], chosenColor: asColor('purple') }).ok).toBe(false);
    const r = applyAction(s, { type: 'draw', seat: 0 });
    if (!r.ok) throw new Error(r.error);
    // The colour is still red, so the red 3 ends the loop after three cards. With
    // 'purple' in currentColor nothing would ever match and the pile would drain.
    expect(r.effects).toContainEqual({ type: 'drew', seat: 0, count: 3 });
    expect(r.state.drawPile).toHaveLength(2);
  });
});
