import type { Card, Color } from '@uno/shared';
import { buildDeck, shuffle } from './deck.js';

export interface PlayerState { hand: Card[]; calledLastCard: boolean; removed: boolean }

export interface GameState {
  players: PlayerState[];
  drawPile: Card[];
  discard: Card[];
  turn: number;
  direction: 1 | -1;
  currentColor: Color | null;
  mustChooseColor: boolean;
  pendingDrawn: { seat: number; cardId: number } | null;
  catchWindow: { seat: number } | null;
  winner: number | null;
  reshuffleSeed: number; // advances on every discard reshuffle for determinism
}

export function nextSeat(state: GameState, from: number, steps = 1): number {
  const n = state.players.length;
  let seat = from;
  for (let remaining = steps; remaining > 0; remaining--) {
    do {
      seat = (((seat + state.direction) % n) + n) % n;
    } while (state.players[seat]!.removed);
  }
  return seat;
}

export function createGame(numPlayers: number, random: () => number): GameState {
  const drawPile = shuffle(buildDeck(), random);
  const players: PlayerState[] = Array.from({ length: numPlayers }, () => ({
    hand: [], calledLastCard: false, removed: false,
  }));
  for (let round = 0; round < 7; round++) {
    for (const p of players) p.hand.push(drawPile.pop()!);
  }

  // Flip the first discard; a wild4 is buried and the next card flipped instead.
  let first = drawPile.pop()!;
  while (first.value === 'wild4') {
    drawPile.unshift(first);
    first = drawPile.pop()!;
  }

  const state: GameState = {
    players, drawPile, discard: [first],
    turn: 0, direction: 1,
    currentColor: first.color,
    mustChooseColor: false,
    pendingDrawn: null, catchWindow: null, winner: null,
    reshuffleSeed: Math.floor(random() * 2 ** 31),
  };

  switch (first.value) {
    case 'skip':
      state.turn = nextSeat(state, 0);
      break;
    case 'reverse':
      state.direction = -1;
      state.turn = nextSeat({ ...state, direction: -1 }, 0);
      break;
    case 'draw2':
      state.players[0]!.hand.push(state.drawPile.pop()!, state.drawPile.pop()!);
      state.turn = nextSeat(state, 0);
      break;
    case 'wild':
      state.currentColor = null;
      state.mustChooseColor = true;
      break;
    default:
      break; // number card: seat 0 starts on the card's color
  }
  return state;
}
