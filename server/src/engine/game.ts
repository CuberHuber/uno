import type { Card, Color } from '@uno/shared';
import { buildDeck, shuffle } from './deck.js';
import { isPlayable, type Effect } from '@uno/shared';
import { rng } from './deck.js';

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

export type Action =
  | { type: 'play'; seat: number; cardId: number; chosenColor?: Color }
  | { type: 'draw'; seat: number }
  | { type: 'pass'; seat: number }
  | { type: 'chooseColor'; seat: number; color: Color }
  | { type: 'callLastCard'; seat: number }
  | { type: 'catchLastCard'; seat: number };

export type ActionResult =
  | { ok: true; state: GameState; effects: Effect[] }
  | { ok: false; error: string };

/** Draw `count` cards for `seat`, reshuffling the discard (minus its top) when
 *  the pile empties. Returns how many were actually drawn (both piles can run dry). */
function drawFromPile(s: GameState, seat: number, count: number): number {
  const p = s.players[seat]!;
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    if (s.drawPile.length === 0 && s.discard.length > 1) {
      const top = s.discard.pop()!;
      s.reshuffleSeed = (s.reshuffleSeed + 1) >>> 0;
      s.drawPile = shuffle(s.discard, rng(s.reshuffleSeed));
      s.discard = [top];
    }
    const card = s.drawPile.pop();
    if (!card) break;
    p.hand.push(card);
    drawn++;
  }
  if (p.hand.length > 1) p.calledLastCard = false;
  return drawn;
}

export function applyAction(state: GameState, action: Action): ActionResult {
  const s = structuredClone(state);
  const effects: Effect[] = [];
  const err = (error: string): ActionResult => ({ ok: false, error });

  if (s.winner !== null) return err('round is over');
  const player = s.players[action.seat];
  if (!player || player.removed) return err('bad seat');

  switch (action.type) {
    case 'chooseColor': {
      if (!s.mustChooseColor || s.turn !== action.seat) return err('no color choice pending');
      s.currentColor = action.color;
      s.mustChooseColor = false;
      return { ok: true, state: s, effects };
    }

    case 'play': {
      if (s.turn !== action.seat) return err('not your turn');
      if (s.mustChooseColor) return err('choose a color first');
      if (s.pendingDrawn && s.pendingDrawn.seat === action.seat && s.pendingDrawn.cardId !== action.cardId)
        return err('play the drawn card or pass');
      const idx = player.hand.findIndex((c) => c.id === action.cardId);
      if (idx === -1) return err('card not in hand');
      const card = player.hand[idx]!;
      const top = s.discard.at(-1)!;
      if (!isPlayable(card, top, s.currentColor)) return err('card does not match');
      const isWild = card.value === 'wild' || card.value === 'wild4';
      if (isWild && !action.chosenColor) return err('wild needs a color');

      s.catchWindow = null; // the next act closes any open window (may re-arm below)
      s.pendingDrawn = null;
      player.hand.splice(idx, 1);
      s.discard.push(card);
      s.currentColor = isWild ? action.chosenColor! : card.color;
      effects.push({ type: 'played', seat: action.seat, card });

      if (player.hand.length === 0) {
        s.winner = action.seat;
        effects.push({ type: 'win', seat: action.seat });
        return { ok: true, state: s, effects };
      }
      if (player.hand.length === 1 && !player.calledLastCard) {
        s.catchWindow = { seat: action.seat };
      }

      const active = s.players.filter((p) => !p.removed).length;
      switch (card.value) {
        case 'skip':
          s.turn = nextSeat(s, action.seat, 2);
          break;
        case 'reverse':
          if (active === 2) {
            s.turn = action.seat; // acts as skip: same player again
          } else {
            s.direction = s.direction === 1 ? -1 : 1;
            s.turn = nextSeat(s, action.seat);
          }
          break;
        case 'draw2': {
          const victim = nextSeat(s, action.seat);
          const n = drawFromPile(s, victim, 2);
          effects.push({ type: 'drew', seat: victim, count: n });
          s.turn = nextSeat(s, action.seat, 2);
          break;
        }
        case 'wild4': {
          const victim = nextSeat(s, action.seat);
          const n = drawFromPile(s, victim, 4);
          effects.push({ type: 'drew', seat: victim, count: n });
          s.turn = nextSeat(s, action.seat, 2);
          break;
        }
        default:
          s.turn = nextSeat(s, action.seat);
      }
      return { ok: true, state: s, effects };
    }

    case 'draw': {
      if (s.turn !== action.seat) return err('not your turn');
      if (s.mustChooseColor) return err('choose a color first');
      if (s.pendingDrawn?.seat === action.seat) return err('play the drawn card or pass');
      s.catchWindow = null;
      const n = drawFromPile(s, action.seat, 1);
      effects.push({ type: 'drew', seat: action.seat, count: n });
      if (n === 0) {
        s.turn = nextSeat(s, action.seat);
        return { ok: true, state: s, effects };
      }
      const drawnCard = player.hand.at(-1)!;
      const top = s.discard.at(-1)!;
      if (isPlayable(drawnCard, top, s.currentColor)) {
        s.pendingDrawn = { seat: action.seat, cardId: drawnCard.id };
      } else {
        s.turn = nextSeat(s, action.seat);
      }
      return { ok: true, state: s, effects };
    }

    case 'pass': {
      if (s.pendingDrawn?.seat !== action.seat) return err('nothing to pass');
      s.pendingDrawn = null;
      s.turn = nextSeat(s, action.seat);
      return { ok: true, state: s, effects };
    }

    case 'callLastCard': {
      const ownWindow = s.catchWindow?.seat === action.seat;
      const arming = s.turn === action.seat && player.hand.length <= 2 && player.hand.length > 0;
      if (!ownWindow && !arming) return err('cannot call now');
      player.calledLastCard = true;
      if (ownWindow) s.catchWindow = null;
      effects.push({ type: 'called', seat: action.seat });
      return { ok: true, state: s, effects };
    }

    case 'catchLastCard': {
      if (!s.catchWindow) return err('nothing to catch');
      const target = s.catchWindow.seat;
      if (target === action.seat) return err('cannot catch yourself');
      s.catchWindow = null;
      const n = drawFromPile(s, target, 2);
      effects.push({ type: 'caught', seat: target });
      effects.push({ type: 'drew', seat: target, count: n });
      return { ok: true, state: s, effects };
    }
  }
}
