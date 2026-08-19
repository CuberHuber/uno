import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Color, Effect, RoomStateView, Rules } from '@uno/shared';
import { track } from './analytics';
import { reportError } from './errors';
import { socket } from './socket';

export interface Store {
  view: RoomStateView | null;
  error: string | null;      // fatal join error → "table not found" screen
  joinError: string | null;  // transient join failure: pin_required / wrong_pin / rate_limited…
  rejection: string | null;  // transient moveRejected, clears itself
  selfDisconnected: boolean; // OUR socket dropped (not another player's)
  effect: Effect | null;
  join: (code: string, name?: string, pin?: string) => void;
  actions: {
    start: () => void;
    setRules: (rules: Rules) => void;
    setPin: (pin: string | null) => void;
    play: (cardIds: number[], chosenColor?: Color) => void;
    draw: () => void;
    pass: () => void;
    chooseColor: (color: Color) => void;
    call: () => void;
    catchCall: () => void;
    rematch: () => void;
    continueWithout: (seat: number) => void;
  };
}

const Ctx = createContext<Store | null>(null);
export const useStore = (): Store => {
  const store = useContext(Ctx);
  if (!store) throw new Error('useStore outside StoreProvider');
  return store;
};

const tokenKey = (code: string) => `ochre:${code.toUpperCase()}`;

// Failures a new attempt can fix stay on the join screen; the rest are fatal.
const TRANSIENT = ['pin_required', 'wrong_pin', 'rate_limited', 'table_full', 'game_started'];

export function StoreProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<RoomStateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [selfDisconnected, setSelfDisconnected] = useState(false);
  const [effect, setEffect] = useState<Effect | null>(null);

  // Our own transport state, for the "connection lost" banner: PauseOverlay
  // only covers OTHER players dropping; before this, your own drop just froze
  // the table with no explanation.
  useEffect(() => {
    const onDisconnect = () => setSelfDisconnected(true);
    const onConnect = () => setSelfDisconnected(false);
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    return () => {
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
    };
  }, []);

  useEffect(() => {
    const onReject = (p: { reason: string }) => {
      setRejection(p.reason);
      setTimeout(() => setRejection(null), 1500);
    };
    socket.on('roomState', setView);
    socket.on('moveRejected', onReject);
    socket.on('effect', setEffect);
    return () => {
      socket.off('roomState', setView);
      socket.off('moveRejected', onReject);
      socket.off('effect', setEffect);
    };
  }, []);

  // Socket.IO reconnected (phone unlocked, network back): retake the held seat.
  useEffect(() => {
    const code = view?.roomCode;
    if (!code) return;
    const onReconnect = () => {
      const token = localStorage.getItem(tokenKey(code)) ?? undefined;
      socket.emit('joinRoom', { code, token }, (ack) => {
        if (ack.ok) return;
        // The ack used to be ignored: a room swept while we were offline left
        // the player staring at a frozen table. Now it's an explicit state.
        const reason = ack.error ?? 'table_not_found';
        track('reconnect_failed', { reason });
        reportError('reconnect_failed', reason, 'warning');
        if (!TRANSIENT.includes(reason)) setError(reason);
      });
    };
    socket.io.on('reconnect', onReconnect);
    return () => { socket.io.off('reconnect', onReconnect); };
  }, [view?.roomCode]);

  // Round lifecycle events for the external analytics; a reconnect mid-round
  // re-reports round_started, which is close enough for dashboard purposes.
  const prevPhase = useRef<RoomStateView['phase'] | null>(null);
  useEffect(() => {
    const prev = prevPhase.current;
    if (!view) return;
    prevPhase.current = view.phase;
    if (view.phase === 'playing' && prev !== 'playing') track('round_started');
    if (view.phase === 'roundEnd' && prev === 'playing') {
      track('round_finished', { won: view.winnerSeat === view.yourSeat });
    }
  }, [view?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const join = (code: string, name?: string, pin?: string) => {
    const token = localStorage.getItem(tokenKey(code)) ?? undefined;
    if (!socket.connected) socket.connect();
    socket.emit('joinRoom', { code, name, token, pin }, (ack) => {
      if (!ack.ok || !ack.token) {
        const reason = ack.error ?? 'table_not_found';
        if (TRANSIENT.includes(reason)) setJoinError(reason);
        else setError(reason);
        return;
      }
      setJoinError(null);
      if (!token) track('room_joined'); // a held token means resume, not a fresh seat
      localStorage.setItem(tokenKey(code), ack.token);
    });
  };

  const actions = useMemo<Store['actions']>(() => ({
    start: () => socket.emit('startGame'),
    setRules: (rules) => socket.emit('setRules', { rules }),
    setPin: (pin) => socket.emit('setPin', { pin }),
    play: (cardIds, chosenColor) => socket.emit('playCards', { cardIds, chosenColor }),
    draw: () => socket.emit('drawCard'),
    pass: () => socket.emit('passTurn'),
    chooseColor: (color) => socket.emit('chooseColor', { color }),
    call: () => socket.emit('callLastCard'),
    catchCall: () => socket.emit('catchLastCard'),
    rematch: () => socket.emit('rematch'),
    continueWithout: (seat) => socket.emit('continueWithout', { seat }),
  }), []);

  return (
    <Ctx.Provider value={{ view, error, joinError, rejection, selfDisconnected, effect, join, actions }}>
      {children}
    </Ctx.Provider>
  );
}
