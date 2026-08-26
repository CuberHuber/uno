import type { Card, Color, Rules } from '@uno/shared';
import { advanceSeed, buildDeck, isColor, newSeed, seedStream, shuffle } from './deck.js';
import { CLASSIC_RULES, isNumberCard, isPlayable, type Effect } from '@uno/shared';
import {
  openingSeating, passTurn, reverseTurn, seatAfter, seatsInRound, withdrawSeat,
} from './seating.js';

export interface PlayerState { hand: Card[]; calledLastCard: boolean; removed: boolean }

export interface GameState {
  players: PlayerState[];
  drawPile: Card[];
  discard: Card[];
  turn: number;
  direction: 1 | -1;
  currentColor: Color | null;
  pendingDrawn: { seat: number; cardId: number } | null;
  catchWindow: { seat: number } | null;
  winner: number | null;
  rules: Rules;
  pendingDraw: number;   // stacking pot the turn seat owes; 0 when settled
  pendingDrawKind: 'draw2' | 'wild4' | null; // which kind answers the pot (strict stacking)
  reshuffleSeed: string; // 256-bit; advances on every discard reshuffle
}

/** Where the turn lands `steps` places on from `from`. A reading of the turn queue
 *  that moves nothing — kept under its old name because callers and tests ask this
 *  question. The order itself lives in `seating.ts`. */
export function nextSeat(state: GameState, from: number, steps = 1): number {
  return seatAfter(state, from, steps);
}

export function createGame(numPlayers: number, random: () => number, rules: Rules = CLASSIC_RULES): GameState {
  const drawPile = shuffle(buildDeck(), random);
  const players: PlayerState[] = Array.from({ length: numPlayers }, () => ({
    hand: [], calledLastCard: false, removed: false,
  }));
  for (let round = 0; round < 7; round++) {
    for (const p of players) p.hand.push(drawPile.pop()!);
  }

  // Only a number card may open a round. Anything else is buried at the bottom of
  // the pile — it stays in play, just not as the opener — and the next card is
  // flipped instead. Dealing is a pre-round phase: whatever it had to dig through,
  // the round it hands over always starts from the same clean position.
  let first = drawPile.pop()!;
  while (!isNumberCard(first)) {
    drawPile.unshift(first);
    first = drawPile.pop()!;
  }

  return {
    players, drawPile, discard: [first],
    ...openingSeating(players.length),
    currentColor: first.color,
    pendingDrawn: null, catchWindow: null, winner: null,
    rules: { ...rules }, pendingDraw: 0, pendingDrawKind: null,
    reshuffleSeed: newSeed(random),
  };
}

export type Action =
  | { type: 'play'; seat: number; cardIds: number[]; chosenColor?: Color }
  | { type: 'draw'; seat: number }
  | { type: 'pass'; seat: number }
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
      s.reshuffleSeed = advanceSeed(s.reshuffleSeed);
      s.drawPile = shuffle(s.discard, seedStream(s.reshuffleSeed));
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
    case 'play': {
      if (s.turn !== action.seat) return err('not_your_turn');
      // A drawn card has to be part of whatever goes down — but under stack discard
      // it may bring the rest of its rank along, so membership is all we require.
      if (s.pendingDrawn && s.pendingDrawn.seat === action.seat
          && !action.cardIds.includes(s.pendingDrawn.cardId))
        return err('play_drawn_or_pass');
      if (action.cardIds.length === 0) return err('card_not_in_hand');
      if (new Set(action.cardIds).size !== action.cardIds.length) return err('bad_stack');
      const picked = action.cardIds.map((id) => player.hand.find((c) => c.id === id));
      if (picked.some((c) => !c)) return err('card_not_in_hand');
      const stack = picked as Card[];
      const card = stack[0]!;
      // A multi-card stack: same-value number cards only, never onto an owed pot.
      if (stack.length > 1) {
        if (!s.rules.multiDiscard) return err('bad_stack');
        if (s.pendingDraw > 0) return err('answer_pot');
        if (!stack.every((c) => isNumberCard(c) && c.value === card.value)) return err('bad_stack');
      }
      const top = s.discard.at(-1)!;
      // Strict stacking: a +2 pot is answered only by a +2, a +4 pot only by a +4.
      const stackAnswer = s.pendingDraw > 0 && card.value === s.pendingDrawKind;
      if (s.pendingDraw > 0 && !stackAnswer) return err('answer_pot');
      if (!stackAnswer && !isPlayable(card, top, s.currentColor)) return err('card_no_match');
      const isWild = card.value === 'wild' || card.value === 'wild4';
      // The colour is a caller's word, not the engine's: only one of the four real
      // colours may become the round's colour.
      let wildColor: Color | null = null;
      if (isWild) {
        if (!isColor(action.chosenColor)) return err('wild_needs_color');
        wildColor = action.chosenColor;
      }

      s.catchWindow = null; // the next act closes any open window (may re-arm below)
      s.pendingDrawn = null;
      for (const c of stack) {
        const at = player.hand.findIndex((h) => h.id === c.id);
        if (at === -1) return err('card_not_in_hand'); // never guess: splice(-1) eats the wrong card
        player.hand.splice(at, 1);
      }
      s.discard.push(...stack);
      const last = stack.at(-1)!;
      s.currentColor = wildColor ?? last.color;
      effects.push({ type: 'played', seat: action.seat, cards: stack });

      if (player.hand.length === 0) {
        s.winner = action.seat;
        effects.push({ type: 'win', seat: action.seat });
        return { ok: true, state: s, effects };
      }
      if (player.hand.length === 1 && !player.calledLastCard) {
        s.catchWindow = { seat: action.seat };
      }

      if (stack.length > 1) {
        // Stacks are always number cards: no action effects, the turn just moves on.
        passTurn(s);
        return { ok: true, state: s, effects };
      }

      switch (card.value) {
        case 'skip':
          passTurn(s, 2);
          break;
        case 'reverse':
          // Two players left is not a special case here: the queue knows a ring of
          // two is its own reverse, and hands the turn back to this seat itself.
          reverseTurn(s);
          break;
        case 'draw2': {
          if (s.rules.stacking) {
            s.pendingDraw += 2;
            s.pendingDrawKind = 'draw2';
            passTurn(s); // victim answers: stack or take
            break;
          }
          const victim = nextSeat(s, action.seat);
          const n = drawFromPile(s, victim, 2);
          effects.push({ type: 'drew', seat: victim, count: n });
          passTurn(s, 2);
          break;
        }
        case 'wild4': {
          if (s.rules.stacking) {
            s.pendingDraw += 4;
            s.pendingDrawKind = 'wild4';
            passTurn(s);
            break;
          }
          const victim = nextSeat(s, action.seat);
          const n = drawFromPile(s, victim, 4);
          effects.push({ type: 'drew', seat: victim, count: n });
          passTurn(s, 2);
          break;
        }
        default:
          passTurn(s);
      }
      return { ok: true, state: s, effects };
    }

    case 'draw': {
      if (s.turn !== action.seat) return err('not_your_turn');
      if (s.pendingDrawn?.seat === action.seat) return err('play_drawn_or_pass');
      s.catchWindow = null;
      if (s.pendingDraw > 0) {
        // Taking the stacked pot: draw it all, no play-or-pass, turn moves on.
        const owed = s.pendingDraw;
        s.pendingDraw = 0;
        s.pendingDrawKind = null;
        const n = drawFromPile(s, action.seat, owed);
        effects.push({ type: 'drew', seat: action.seat, count: n });
        passTurn(s);
        return { ok: true, state: s, effects };
      }
      // Draw one card — or, under drawToMatch, keep drawing to the first playable.
      let total = 0;
      let drawnCard: Card | null = null;
      for (;;) {
        const n = drawFromPile(s, action.seat, 1);
        if (n === 0) { drawnCard = null; break; }
        total += 1;
        drawnCard = player.hand.at(-1)!;
        const playable = isPlayable(drawnCard, s.discard.at(-1)!, s.currentColor);
        if (playable || !s.rules.drawToMatch) break;
      }
      effects.push({ type: 'drew', seat: action.seat, count: total });
      if (!drawnCard || !isPlayable(drawnCard, s.discard.at(-1)!, s.currentColor)) {
        passTurn(s);
        return { ok: true, state: s, effects };
      }
      const isWildDraw = drawnCard.value === 'wild' || drawnCard.value === 'wild4';
      // Under stack discard a drawn card with rank mates in hand is not slammed down
      // alone: the player still decides how much of that rank goes with it. Force
      // play only removes the option to walk away, which `pass` keeps refusing.
      const hasRankMates = s.rules.multiDiscard && isNumberCard(drawnCard)
        && player.hand.some((c) => c.id !== drawnCard!.id && c.value === drawnCard!.value);
      if (s.rules.forcePlay && !isWildDraw && !hasRankMates) {
        // Force play: the drawn card goes straight down (wilds wait for a colour).
        const played = applyAction(s, { type: 'play', seat: action.seat, cardIds: [drawnCard.id] });
        if (!played.ok) return played; // the rule says this play is legal; if it is not, say so
        return { ok: true, state: played.state, effects: [...effects, ...played.effects] };
      }
      s.pendingDrawn = { seat: action.seat, cardId: drawnCard.id };
      return { ok: true, state: s, effects };
    }

    case 'pass': {
      if (s.pendingDrawn?.seat !== action.seat) return err('nothing_to_pass');
      if (s.rules.forcePlay) return err('force_play');
      s.catchWindow = null; // like every other act, passing closes an open window
      s.pendingDrawn = null;
      passTurn(s);
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

/** Remove a seat from the current round: take them out of the turn queue, bury
 *  their cards at the bottom of the draw pile, and end the round if only one
 *  player remains. The queue moves the turn off the leaver by itself. */
export function removeFromRound(state: GameState, seat: number): GameState {
  const s = structuredClone(state);
  const p = Number.isInteger(seat) ? s.players[seat] : undefined;
  if (!p) return s; // no such seat: nothing to remove, and nothing to corrupt
  const wasTheirTurn = s.turn === seat;
  // Out of the queue, and the turn steps off them in the same breath: no caller
  // has to remember that a leaver may have been holding it.
  withdrawSeat(s, seat);
  s.drawPile.unshift(...p.hand);
  p.hand = [];
  if (s.pendingDrawn?.seat === seat) s.pendingDrawn = null;
  if (s.catchWindow?.seat === seat) s.catchWindow = null;
  const active = seatsInRound(s);
  if (active.length === 1) {
    s.winner = active[0] ?? null;
    return s;
  }
  if (wasTheirTurn) {
    s.pendingDraw = 0; // an owed pot dies with the leaver
    s.pendingDrawKind = null;
  }
  return s;
}
