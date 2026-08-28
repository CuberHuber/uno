import { isPlayable, type Phase, type RoomStateView, type Rules } from '@uno/shared';
import type { GameState } from './game.js';

/** Which of the viewer's cards may lead a play right now. The rules used to live
 *  twice — once here in the engine, once again in the browser — and nothing kept
 *  the two honest. Now the round says what is legal and the client only draws it.
 *  Mirrors the lead-card acceptance in `applyAction`'s `play` case exactly. */
function legalFor(g: GameState, seat: number): number[] {
  if (g.winner !== null || g.turn !== seat) return [];
  const player = g.players[seat];
  const top = g.discard.at(-1);
  if (!player || player.removed || !top) return [];
  // A drawn card owes an answer: it either goes down itself or the turn passes.
  const owed = g.pendingDrawn?.seat === seat ? g.pendingDrawn.cardId : null;
  return player.hand
    .filter((c) => owed === null || owed === c.id)
    // Strict stacking: an owed pot is answered only by its own kind.
    .filter((c) => (g.pendingDraw > 0
      ? c.value === g.pendingDrawKind
      : isPlayable(c, top, g.currentColor)))
    .map((c) => c.id);
}

export interface ViewContext {
  roomCode: string;
  phase: Phase;
  names: string[];
  hostSeat: number;
  connected: boolean[];
  winTally: number[];
  pausedForSeat: number | null;
  pausedSinceMs: number | null;
  rules: Rules;
  hasPin: boolean;
  pin: string | null; // the actual digits; only ever set for the host's view
  game: GameState | null;
}

export function projectView(ctx: ViewContext, seat: number): RoomStateView {
  const g = ctx.game;
  return {
    roomCode: ctx.roomCode,
    phase: ctx.phase,
    yourSeat: seat,
    hand: g ? g.players[seat]!.hand : [],
    legal: g ? legalFor(g, seat) : [],
    seats: ctx.names
      .map((name, i) => ({
        seat: i,
        name,
        cardCount: g ? g.players[i]!.hand.length : 0,
        connected: ctx.connected[i] ?? false,
        calledLastCard: g ? g.players[i]!.calledLastCard : false,
        isHost: i === ctx.hostSeat,
      }))
      .filter((sv) => !g?.players[sv.seat]?.removed),
    turnSeat: g && g.winner === null ? g.turn : null,
    direction: g ? g.direction : 1,
    topCard: g ? g.discard.at(-1)! : null,
    currentColor: g ? g.currentColor : null,
    pendingDrawnCardId: g?.pendingDrawn?.seat === seat ? g.pendingDrawn.cardId : null,
    catchableSeat: g?.catchWindow?.seat ?? null,
    drawPileCount: g ? g.drawPile.length : 0,
    rules: ctx.rules,
    hasPin: ctx.hasPin,
    pin: ctx.pin,
    pendingDraw: g ? g.pendingDraw : 0,
    pendingDrawKind: g ? g.pendingDrawKind : null,
    winnerSeat: g ? g.winner : null,
    winTally: ctx.winTally,
    paused: ctx.pausedForSeat !== null,
    pausedForName: ctx.pausedForSeat !== null ? ctx.names[ctx.pausedForSeat]! : null,
    pausedSinceMs: ctx.pausedSinceMs,
  };
}
