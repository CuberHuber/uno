import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Color, Effect, RoomStateView, Rules } from '@uno/shared';
import { socket } from './socket';
import { rulesStashKey } from './ui';

export interface Store {
  view: RoomStateView | null;
  error: string | null;      // fatal join error → "table not found" screen
  rejection: string | null;  // transient moveRejected, clears itself
  effect: Effect | null;
  join: (code: string, name?: string) => void;
  actions: {
    start: () => void;
    setRules: (rules: Rules) => void;
    play: (cardId: number, chosenColor?: Color) => void;
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

export function StoreProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<RoomStateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [effect, setEffect] = useState<Effect | null>(null);

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
      socket.emit('joinRoom', { code, token }, () => {});
    };
    socket.io.on('reconnect', onReconnect);
    return () => { socket.io.off('reconnect', onReconnect); };
  }, [view?.roomCode]);

  const join = (code: string, name?: string) => {
    const token = localStorage.getItem(tokenKey(code)) ?? undefined;
    if (!socket.connected) socket.connect();
    socket.emit('joinRoom', { code, name, token }, (ack) => {
      if (!ack.ok || !ack.token) { setError(ack.error ?? 'table not found'); return; }
      localStorage.setItem(tokenKey(code), ack.token);
      // The host picked house rules before sitting down; apply them now that we hold the seat.
      const stash = sessionStorage.getItem(rulesStashKey(code));
      if (stash) {
        sessionStorage.removeItem(rulesStashKey(code));
        try { socket.emit('setRules', { rules: JSON.parse(stash) as Rules }); } catch { /* stale stash */ }
      }
    });
  };

  const actions = useMemo<Store['actions']>(() => ({
    start: () => socket.emit('startGame'),
    setRules: (rules) => socket.emit('setRules', { rules }),
    play: (cardId, chosenColor) => socket.emit('playCard', { cardId, chosenColor }),
    draw: () => socket.emit('drawCard'),
    pass: () => socket.emit('passTurn'),
    chooseColor: (color) => socket.emit('chooseColor', { color }),
    call: () => socket.emit('callLastCard'),
    catchCall: () => socket.emit('catchLastCard'),
    rematch: () => socket.emit('rematch'),
    continueWithout: (seat) => socket.emit('continueWithout', { seat }),
  }), []);

  return (
    <Ctx.Provider value={{ view, error, rejection, effect, join, actions }}>
      {children}
    </Ctx.Provider>
  );
}
