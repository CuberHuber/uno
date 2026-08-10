import type { Phase, RoomStateView } from '@uno/shared';
import type { GameState } from './game.js';

export interface ViewContext {
  roomCode: string;
  phase: Phase;
  names: string[];
  hostSeat: number;
  connected: boolean[];
  winTally: number[];
  pausedForSeat: number | null;
  pausedSinceMs: number | null;
  game: GameState | null;
}

export function projectView(ctx: ViewContext, seat: number): RoomStateView {
  const g = ctx.game;
  return {
    roomCode: ctx.roomCode,
    phase: ctx.phase,
    yourSeat: seat,
    hand: g ? g.players[seat]!.hand : [],
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
    mustChooseColor: g ? g.mustChooseColor && g.turn === seat : false,
    pendingDrawnCardId: g?.pendingDrawn?.seat === seat ? g.pendingDrawn.cardId : null,
    catchableSeat: g?.catchWindow?.seat ?? null,
    drawPileCount: g ? g.drawPile.length : 0,
    winnerSeat: g ? g.winner : null,
    winTally: ctx.winTally,
    paused: ctx.pausedForSeat !== null,
    pausedForName: ctx.pausedForSeat !== null ? ctx.names[ctx.pausedForSeat]! : null,
    pausedSinceMs: ctx.pausedSinceMs,
  };
}
