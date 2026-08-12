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
  stacking: boolean;     // +2 answers only +2, +4 answers only +4; the pot rides on
  forcePlay: boolean;    // a drawn playable card goes straight down
  drawToMatch: boolean;  // no play → draw until a playable card arrives
  multiDiscard: boolean; // same-value number cards may be discarded together
}
export const CLASSIC_RULES: Rules = {
  stacking: false, forcePlay: false, drawToMatch: false, multiDiscard: false,
};
export const sanitizeRules = (r?: Partial<Rules> | null): Rules => ({
  stacking: !!r?.stacking, forcePlay: !!r?.forcePlay,
  drawToMatch: !!r?.drawToMatch, multiDiscard: !!r?.multiDiscard,
});

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
  playCard: (p: { cardId: number; chosenColor?: Color }) => void;
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
