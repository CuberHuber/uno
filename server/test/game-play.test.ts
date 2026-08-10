import { describe, expect, test } from 'vitest';
import { applyAction, type GameState } from '../src/engine/game.js';
import type { Card } from '@uno/shared';

let nextId = 1000;
export const card = (color: Card['color'], value: Card['value']): Card =>
  ({ id: nextId++, color, value });

export function fixedState(hands: Card[][], top: Card, opts: Partial<GameState> = {}): GameState {
  return {
    players: hands.map((hand) => ({ hand, calledLastCard: false, removed: false })),
    drawPile: Array.from({ length: 20 }, () => card('green', '5')),
    discard: [top],
    turn: 0,
    direction: 1,
    currentColor: top.color,
    mustChooseColor: false,
    pendingDrawn: null,
    catchWindow: null,
    winner: null,
    reshuffleSeed: 1,
    ...opts,
  };
}

describe('play — validation', () => {
  test('rejects out-of-turn plays', () => {
    const c0 = card('red', '3');
    const s = fixedState([[c0], [card('red', '4')]], card('red', '7'), { turn: 1 });
    const r = applyAction(s, { type: 'play', seat: 0, cardId: c0.id });
    expect(r.ok).toBe(false);
  });
  test('rejects non-matching card', () => {
    const c0 = card('blue', '3');
    const s = fixedState([[c0], []], card('red', '7'));
    expect(applyAction(s, { type: 'play', seat: 0, cardId: c0.id }).ok).toBe(false);
  });
  test('rejects card not in hand and does not mutate input', () => {
    const s = fixedState([[card('red', '3')], []], card('red', '7'));
    const before = JSON.stringify(s);
    expect(applyAction(s, { type: 'play', seat: 0, cardId: 99999 }).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('play — number cards', () => {
  test('moves card to discard, sets color, advances turn', () => {
    const c0 = card('blue', '7');
    const s = fixedState([[c0, card('red', '1')], [card('green', '2')]], card('red', '7'));
    const r = applyAction(s, { type: 'play', seat: 0, cardId: c0.id });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.discard.at(-1)!.id).toBe(c0.id);
    expect(r.state.currentColor).toBe('blue');
    expect(r.state.turn).toBe(1);
    expect(r.effects).toContainEqual({ type: 'played', seat: 0, card: c0 });
  });
});

describe('play — action cards', () => {
  test('skip jumps one player (3p)', () => {
    const c0 = card('red', 'skip');
    const s = fixedState([[c0, card('red', '1')], [card('green', '2')], [card('blue', '2')]], card('red', '7'));
    const r = applyAction(s, { type: 'play', seat: 0, cardId: c0.id });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.turn).toBe(2);
  });
  test('reverse flips direction (3p)', () => {
    const c0 = card('red', 'reverse');
    const s = fixedState([[c0, card('red', '1')], [card('green', '2')], [card('blue', '2')]], card('red', '7'));
    const r = applyAction(s, { type: 'play', seat: 0, cardId: c0.id });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.direction).toBe(-1);
    expect(r.state.turn).toBe(2);
  });
  test('reverse acts as skip in 2p: same player goes again', () => {
    const c0 = card('red', 'reverse');
    const s = fixedState([[c0, card('red', '1')], [card('green', '2')]], card('red', '7'));
    const r = applyAction(s, { type: 'play', seat: 0, cardId: c0.id });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.turn).toBe(0);
    expect(r.state.direction).toBe(1);
  });
  test('draw2: victim draws 2 and is skipped', () => {
    const c0 = card('red', 'draw2');
    const s = fixedState([[c0, card('red', '1')], [card('green', '2')], [card('blue', '2')]], card('red', '7'));
    const r = applyAction(s, { type: 'play', seat: 0, cardId: c0.id });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.players[1]!.hand).toHaveLength(3);
    expect(r.state.turn).toBe(2);
    expect(r.effects).toContainEqual({ type: 'drew', seat: 1, count: 2 });
  });
});

describe('play — winning', () => {
  test('playing the last card ends the round', () => {
    const c0 = card('red', '3');
    const s = fixedState([[c0], [card('green', '2')]], card('red', '7'));
    const r = applyAction(s, { type: 'play', seat: 0, cardId: c0.id });
    if (!r.ok) throw new Error(r.error);
    expect(r.state.winner).toBe(0);
    expect(r.effects).toContainEqual({ type: 'win', seat: 0 });
  });
  test('no actions accepted after the round ends', () => {
    const s = fixedState([[card('red', '3')], [card('green', '2')]], card('red', '7'), { winner: 1 });
    expect(applyAction(s, { type: 'draw', seat: 0 }).ok).toBe(false);
  });
});
