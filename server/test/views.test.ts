import { describe, expect, test } from 'vitest';
import { projectView, type ViewContext } from '../src/engine/views.js';
import { card, fixedState } from './game-play.test.js';

function ctx(overrides: Partial<ViewContext> = {}): ViewContext {
  const game = fixedState(
    [[card('red', '1'), card('blue', '2')], [card('green', '3')]],
    card('red', '7'),
  );
  return {
    roomCode: '4K2P-9XVB', phase: 'playing',
    names: ['Mira', 'Jonas'], hostSeat: 0,
    connected: [true, true], winTally: [0, 0],
    pausedForSeat: null, pausedSinceMs: null,
    rules: { stacking: false, forcePlay: false, multiPlay: false },
    game, ...overrides,
  };
}

describe('projectView', () => {
  test('you see your own hand; opponents appear as counts only', () => {
    const v0 = projectView(ctx(), 0);
    expect(v0.hand).toHaveLength(2);
    expect(v0.seats[1]).toMatchObject({ name: 'Jonas', cardCount: 1 });
    expect(JSON.stringify(v0.seats)).not.toContain('"value"'); // no card objects in seats
    const v1 = projectView(ctx(), 1);
    expect(v1.hand).toHaveLength(1);
    expect(v1.hand[0]!.value).toBe('3');
  });

  test('pendingDrawn and mustChooseColor are personalized', () => {
    const c = ctx();
    c.game!.pendingDrawn = { seat: 0, cardId: c.game!.players[0]!.hand[0]!.id };
    expect(projectView(c, 0).pendingDrawnCardId).not.toBeNull();
    expect(projectView(c, 1).pendingDrawnCardId).toBeNull();
    const c2 = ctx();
    c2.game!.mustChooseColor = true;
    c2.game!.turn = 0;
    expect(projectView(c2, 0).mustChooseColor).toBe(true);
    expect(projectView(c2, 1).mustChooseColor).toBe(false);
  });

  test('removed seats are filtered out of the seat list', () => {
    const c = ctx();
    c.game!.players[1]!.removed = true;
    expect(projectView(c, 0).seats.map((s) => s.seat)).toEqual([0]);
  });

  test('lobby view has empty hand and no top card', () => {
    const v = projectView(ctx({ game: null, phase: 'lobby' }), 0);
    expect(v.hand).toEqual([]);
    expect(v.topCard).toBeNull();
    expect(v.turnSeat).toBeNull();
  });

  test('pause fields carry the disconnected player name', () => {
    const v = projectView(ctx({ pausedForSeat: 1, pausedSinceMs: 12345 }), 0);
    expect(v.paused).toBe(true);
    expect(v.pausedForName).toBe('Jonas');
    expect(v.pausedSinceMs).toBe(12345);
  });
});
