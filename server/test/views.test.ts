import { describe, expect, test } from 'vitest';
import { projectView, type ViewContext } from '../src/engine/views.js';
import { applyAction, createGame, type GameState } from '../src/engine/game.js';
import { rng } from '../src/engine/deck.js';
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
    rules: { stacking: false, forcePlay: false },
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

  test('legal is empty off-turn and never leaks another hand', () => {
    const c = ctx();
    expect(projectView(c, 0).legal.length).toBeGreaterThan(0);
    expect(projectView(c, 1).legal).toEqual([]);
    const mine = new Set(projectView(c, 0).hand.map((h) => h.id));
    for (const id of projectView(c, 0).legal) expect(mine.has(id)).toBe(true);
  });

  test('pendingDrawn is personalized', () => {
    const c = ctx();
    c.game!.pendingDrawn = { seat: 0, cardId: c.game!.players[0]!.hand[0]!.id };
    expect(projectView(c, 0).pendingDrawnCardId).not.toBeNull();
    expect(projectView(c, 1).pendingDrawnCardId).toBeNull();
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

// The point of printing `legal` is that the browser stops deciding what is
// playable. That is only worth anything while the printed list and the engine
// agree, so assert the agreement itself rather than a handful of cases: over a
// whole played round, every card in hand is accepted by `applyAction` if and
// only if the view offered it.
describe('legal agrees with the engine', () => {
  const play = (g: GameState, id: number) =>
    applyAction(g, { type: 'play', seat: g.turn, cardIds: [id], chosenColor: 'red' });

  const check = (g: GameState) => {
    const view = projectView(ctx({ game: g, names: ['A', 'B', 'C'], connected: [true, true, true], winTally: [0, 0, 0] }), g.turn);
    const offered = new Set(view.legal);
    for (const c of g.players[g.turn]!.hand) {
      expect(play(g, c.id).ok).toBe(offered.has(c.id));
    }
    return offered;
  };

  for (const rules of [
    { stacking: false, forcePlay: false },
    { stacking: true, forcePlay: false, drawToMatch: true, multiDiscard: true },
  ]) {
    test(`holds move after move — rules ${JSON.stringify(rules)}`, () => {
      for (let seed = 0; seed < 25; seed++) {
        let g = createGame(3, rng(seed), rules as never);
        for (let move = 0; move < 60 && g.winner === null; move++) {
          const offered = check(g);
          const next = offered.size > 0
            ? play(g, [...offered][0]!)
            : applyAction(g, { type: 'draw', seat: g.turn });
          if (!next.ok) throw new Error(`stuck at seed ${seed}, move ${move}: ${next.error}`);
          g = next.state;
        }
      }
    });
  }
});
