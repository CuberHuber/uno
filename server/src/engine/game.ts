import type { Card, Color, Rules } from '@uno/shared';
import { buildDeck, shuffle } from './deck.js';
import { CLASSIC_RULES, isPlayable, type Effect } from '@uno/shared';
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
  rules: Rules;
  pendingDraw: number;   // stacking pot the turn seat owes; 0 when settled
  pendingDrawKind: 'draw2' | 'wild4' | null; // which kind answers the pot (strict stacking)
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

export function createGame(numPlayers: number, random: () => number, rules: Rules = CLASSIC_RULES): GameState {
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
    rules: { ...rules }, pendingDraw: 0, pendingDrawKind: null,
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
      if (rules.stacking) {
        state.pendingDraw = 2; // seat 0 answers the flip: stack or take
        state.pendingDrawKind = 'draw2';
      } else {
        state.players[0]!.hand.push(state.drawPile.pop()!, state.drawPile.pop()!);
        state.turn = nextSeat(state, 0);
      }
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

  if (s.winner !== null) return err('round_over');
  const player = s.players[action.seat];
  if (!player || player.removed) return err('bad_seat');

  switch (action.type) {
    case 'chooseColor': {
      if (!s.mustChooseColor || s.turn !== action.seat) return err('no_color_pending');
      s.currentColor = action.color;
      s.mustChooseColor = false;
      return { ok: true, state: s, effects };
    }

    case 'play': {
      if (s.turn !== action.seat) return err('not_your_turn');
      if (s.mustChooseColor) return err('choose_color_first');
      if (s.pendingDrawn && s.pendingDrawn.seat === action.seat && s.pendingDrawn.cardId !== action.cardId)
        return err('play_drawn_or_pass');
      const idx = player.hand.findIndex((c) => c.id === action.cardId);
      if (idx === -1) return err('card_not_in_hand');
      const card = player.hand[idx]!;
      const top = s.discard.at(-1)!;
      // Strict stacking: a +2 pot is answered only by a +2, a +4 pot only by a +4.
      const stackAnswer = s.pendingDraw > 0 && card.value === s.pendingDrawKind;
      if (s.pendingDraw > 0 && !stackAnswer) return err('answer_pot');
      if (!stackAnswer && !isPlayable(card, top, s.currentColor)) return err('card_no_match');
      const isWild = card.value === 'wild' || card.value === 'wild4';
      if (isWild && !action.chosenColor) return err('wild_needs_color');

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
          if (s.rules.stacking) {
            s.pendingDraw += 2;
            s.pendingDrawKind = 'draw2';
            s.turn = nextSeat(s, action.seat); // victim answers: stack or take
            break;
          }
          const victim = nextSeat(s, action.seat);
          const n = drawFromPile(s, victim, 2);
          effects.push({ type: 'drew', seat: victim, count: n });
          s.turn = nextSeat(s, action.seat, 2);
          break;
        }
        case 'wild4': {
          if (s.rules.stacking) {
            s.pendingDraw += 4;
            s.pendingDrawKind = 'wild4';
            s.turn = nextSeat(s, action.seat);
            break;
          }
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
      if (s.turn !== action.seat) return err('not_your_turn');
      if (s.mustChooseColor) return err('choose_color_first');
      if (s.pendingDrawn?.seat === action.seat) return err('play_drawn_or_pass');
      s.catchWindow = null;
      if (s.pendingDraw > 0) {
        // Taking the stacked pot: draw it all, no play-or-pass, turn moves on.
        const owed = s.pendingDraw;
        s.pendingDraw = 0;
        s.pendingDrawKind = null;
        const n = drawFromPile(s, action.seat, owed);
        effects.push({ type: 'drew', seat: action.seat, count: n });
        s.turn = nextSeat(s, action.seat);
        return { ok: true, state: s, effects };
      }
      const n = drawFromPile(s, action.seat, 1);
      effects.push({ type: 'drew', seat: action.seat, count: n });
      if (n === 0) {
        s.turn = nextSeat(s, action.seat);
        return { ok: true, state: s, effects };
      }
      const drawnCard = player.hand.at(-1)!;
      const top = s.discard.at(-1)!;
      if (isPlayable(drawnCard, top, s.currentColor)) {
        const isWildDraw = drawnCard.value === 'wild' || drawnCard.value === 'wild4';
        if (s.rules.forcePlay && !isWildDraw) {
          // Force play: the drawn card goes straight down (wilds wait for a colour).
          const played = applyAction(s, { type: 'play', seat: action.seat, cardId: drawnCard.id });
          if (played.ok) return { ok: true, state: played.state, effects: [...effects, ...played.effects] };
        }
        s.pendingDrawn = { seat: action.seat, cardId: drawnCard.id };
      } else {
        s.turn = nextSeat(s, action.seat);
      }
      return { ok: true, state: s, effects };
    }

    case 'pass': {
      if (s.pendingDrawn?.seat !== action.seat) return err('nothing_to_pass');
      if (s.rules.forcePlay) return err('force_play');
      s.pendingDrawn = null;
      s.turn = nextSeat(s, action.seat);
      return { ok: true, state: s, effects };
    }

    case 'callLastCard': {
      const ownWindow = s.catchWindow?.seat === action.seat;
      const arming = s.turn === action.seat && player.hand.length <= 2 && player.hand.length > 0;
      if (!ownWindow && !arming) return err('cannot_call_now');
      player.calledLastCard = true;
      if (ownWindow) s.catchWindow = null;
      effects.push({ type: 'called', seat: action.seat });
      return { ok: true, state: s, effects };
    }

    case 'catchLastCard': {
      if (!s.catchWindow) return err('nothing_to_catch');
      const target = s.catchWindow.seat;
      if (target === action.seat) return err('cannot_catch_self');
      s.catchWindow = null;
      const n = drawFromPile(s, target, 2);
      effects.push({ type: 'caught', seat: target });
      effects.push({ type: 'drew', seat: target, count: n });
      return { ok: true, state: s, effects };
    }
  }
}

/** Remove a seat from the current round: bury their cards at the bottom of the
 *  draw pile, fix the turn, and end the round if only one player remains. */
export function removeFromRound(state: GameState, seat: number): GameState {
  const s = structuredClone(state);
  const p = s.players[seat]!;
  p.removed = true;
  s.drawPile.unshift(...p.hand);
  p.hand = [];
  if (s.pendingDrawn?.seat === seat) s.pendingDrawn = null;
  if (s.catchWindow?.seat === seat) s.catchWindow = null;
  const active = s.players.flatMap((pl, i) => (pl.removed ? [] : [i]));
  if (active.length === 1) {
    s.winner = active[0]!;
    return s;
  }
  if (s.turn === seat) {
    if (s.mustChooseColor) {
      s.mustChooseColor = false;
      s.currentColor = s.discard.at(-1)!.color ?? 'red';
    }
    s.pendingDraw = 0; // an owed pot dies with the leaver
    s.pendingDrawKind = null;
    s.turn = nextSeat(s, seat);
  }
  return s;
}
