import { describe, expect, test } from 'vitest';
import { applyAction } from '../src/engine/game.js';
import { card, fixedState } from './game-play.test.js';

describe('calling before playing', () => {
  test('call with two cards on your turn, then play: no catch window', () => {
    const c0 = card('red', '3');
    const s = fixedState([[c0, card('blue', '9')], [card('green', '2')]], card('red', '7'));
    const called = applyAction(s, { type: 'callLastCard', seat: 0 });
    if (!called.ok) throw new Error(called.error);
    expect(called.state.players[0]!.calledLastCard).toBe(true);
    const played = applyAction(called.state, { type: 'play', seat: 0, cardIds: [c0.id] });
    if (!played.ok) throw new Error(played.error);
    expect(played.state.catchWindow).toBeNull();
  });
  test('call is rejected with a full hand out of turn', () => {
    const s = fixedState([[card('red', '3'), card('blue', '9'), card('green', '1')], [card('green', '2')]], card('red', '7'), { turn: 1 });
    expect(applyAction(s, { type: 'callLastCard', seat: 0 }).ok).toBe(false);
  });
});

describe('forgetting to call', () => {
  function windowOpen() {
    const c0 = card('red', '3');
    const s = fixedState([[c0, card('blue', '9')], [card('green', '2')], [card('yellow', '1')]], card('red', '7'));
    const played = applyAction(s, { type: 'play', seat: 0, cardIds: [c0.id] });
    if (!played.ok) throw new Error(played.error);
    expect(played.state.catchWindow).toEqual({ seat: 0 });
    return played.state;
  }

  test('opponent catches: offender draws two, window closes', () => {
    const r = applyAction(windowOpen(), { type: 'catchLastCard', seat: 2 });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[0]!.hand).toHaveLength(3);
    expect(r.state.players[0]!.calledLastCard).toBe(false);
    expect(r.state.catchWindow).toBeNull();
    expect(r.effects).toContainEqual({ type: 'caught', seat: 0 });
  });

  test('late call inside the window saves the player', () => {
    const st = windowOpen();
    const called = applyAction(st, { type: 'callLastCard', seat: 0 });
    if (!called.ok) throw new Error(called.error);
    expect(called.state.catchWindow).toBeNull();
    expect(applyAction(called.state, { type: 'catchLastCard', seat: 2 }).ok).toBe(false);
  });

  test('window closes when the next player acts', () => {
    const st = windowOpen(); // turn is now seat 1
    const next = applyAction(st, { type: 'draw', seat: 1 });
    if (!next.ok) throw new Error(next.error);
    expect(next.state.catchWindow).toBeNull();
    expect(applyAction(next.state, { type: 'catchLastCard', seat: 2 }).ok).toBe(false);
  });

  test('you cannot catch yourself', () => {
    expect(applyAction(windowOpen(), { type: 'catchLastCard', seat: 0 }).ok).toBe(false);
  });
});
