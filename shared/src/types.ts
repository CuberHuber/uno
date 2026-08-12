export type Color = 'red' | 'yellow' | 'green' | 'blue';
export type Value =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';

export interface Card {
  id: number;
  color: Color | null; // null for wild / wild4
  value: Value;
}

export type Phase = 'lobby' | 'playing' | 'roundEnd';

export interface Rules {
  stacking: boolean;  // +2/+4 may be answered with another +2/+4 instead of drawing
  forcePlay: boolean; // a drawn playable card goes straight down
  multiPlay: boolean; // every card of one rank may go down in a single turn
}
export const CLASSIC_RULES: Rules = { stacking: false, forcePlay: false, multiPlay: false };

export interface SeatView {
  seat: number;
  name: string;
  cardCount: number;
  connected: boolean;
  calledLastCard: boolean;
  isHost: boolean;
}

export interface RoomStateView {
  roomCode: string;
  phase: Phase;
  yourSeat: number;
  hand: Card[];
  seats: SeatView[];
  turnSeat: number | null;
  direction: 1 | -1;
  topCard: Card | null;
  currentColor: Color | null;
  mustChooseColor: boolean;      // you flipped/played a positional wild start; pick color first
  pendingDrawnCardId: number | null; // you drew a playable card: play it or pass
  catchableSeat: number | null;  // catch window is open on this seat
  drawPileCount: number;
  rules: Rules;
  pendingDraw: number;           // cards the turn seat owes (stacking pot); 0 otherwise
  winnerSeat: number | null;
  winTally: number[];
  paused: boolean;
  pausedForName: string | null;
  pausedSinceMs: number | null;  // server epoch ms; client derives the 2-minute mark
}

export type Effect =
  | { type: 'played'; seat: number; card: Card }
  | { type: 'drew'; seat: number; count: number }
  | { type: 'called'; seat: number }
  | { type: 'caught'; seat: number }
  | { type: 'win'; seat: number };

export interface JoinAck {
  ok: boolean;
  error?: string;
  seat?: number;
  token?: string;
  roomName?: string;
}

export interface ClientToServerEvents {
  joinRoom: (
    p: { code: string; name?: string; token?: string },
    ack: (r: JoinAck) => void
  ) => void;
  startGame: () => void;
  setRules: (p: { rules: Rules }) => void; // host, lobby only
  // extraCardIds: further cards of the same rank, laid in order (multi-play rule).
  playCard: (p: { cardId: number; chosenColor?: Color; extraCardIds?: number[] }) => void;
  drawCard: () => void;
  passTurn: () => void;          // decline to play a drawn playable card
  chooseColor: (p: { color: Color }) => void; // first-flip wild
  callLastCard: () => void;
  catchLastCard: () => void;
  rematch: () => void;
  continueWithout: (p: { seat: number }) => void;
}

export interface ServerToClientEvents {
  roomState: (view: RoomStateView) => void;
  moveRejected: (p: { reason: string }) => void;
  effect: (e: Effect) => void;
}
