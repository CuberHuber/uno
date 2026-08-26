import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CatchUpView, Color, Effect, RoomStateView, Rules } from '@uno/shared';
import { rulesPreset, setAnalyticsDimensions, track, trackProgression } from './analytics';
import { reportError } from './errors';
import { socket } from './socket';
import { roundsPlayed } from './ui';

export interface Store {
  view: RoomStateView | null;
  error: string | null;      // fatal join error → "table not found" screen
  joinError: string | null;  // transient join failure: pin_required / wrong_pin / rate_limited…
  rejection: string | null;  // transient moveRejected, clears itself
  selfDisconnected: boolean; // OUR socket dropped (not another player's)
  effect: Effect | null;
  catchUp: CatchUpView | null; // what happened while we were away; null when nothing did
  dismissCatchUp: () => void;
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

/** A burst of accepted moves lands as a burst of snapshots, each carrying the
 *  journal head. The pointer is a high-water mark, so acknowledging only the
 *  last of a burst loses nothing and spends one frame instead of a dozen —
 *  which matters, because acknowledgements share the per-socket action budget
 *  with the moves themselves. */
const ACK_COALESCE_MS = 250;

// Failures a new attempt can fix stay on the join screen; the rest are fatal.
const TRANSIENT = ['pin_required', 'wrong_pin', 'rate_limited', 'table_full', 'game_started', 'already_seated'];

export function StoreProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<RoomStateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [selfDisconnected, setSelfDisconnected] = useState(false);
  const [effect, setEffect] = useState<Effect | null>(null);
  const [catchUp, setCatchUp] = useState<CatchUpView | null>(null);

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

  // The journal pointer. The server moves it only on our word, and only
  // forward, so this is the one thing standing between a reconnect that replays
  // exactly what was missed and one that is told the gap is too old to answer.
  //
  // Every snapshot arrives with the head it is true as of; applying the
  // snapshot is what makes acknowledging that head honest. Compared with `!==`
  // rather than `>`: heads only rise inside one room, and a tab that somehow
  // lands in a second room must not carry the first room's number as a floor
  // and go silent. Re-acknowledging an older number is harmless — the server
  // keeps the larger of the two.
  const acked = useRef(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: number | null = null;
    const flush = () => {
      timer = null;
      const seq = pending;
      pending = null;
      if (seq === null) return;
      acked.current = seq;
      socket.emit('ackHistory', { seq });
    };
    const onHead = (p: { seq: number }) => {
      if (p.seq === acked.current || p.seq === pending) return;
      pending = p.seq;
      if (timer === null) timer = setTimeout(flush, ACK_COALESCE_MS);
    };
    // A socket that dies can take an unsent acknowledgement with it. Forgetting
    // what we acknowledged costs one frame on the way back in and closes the
    // gap where the server's pointer would otherwise sit behind where we are.
    const onDrop = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
      acked.current = 0;
    };
    socket.on('historyHead', onHead);
    socket.on('catchUp', setCatchUp);
    socket.on('disconnect', onDrop);
    return () => {
      socket.off('historyHead', onHead);
      socket.off('catchUp', setCatchUp);
      socket.off('disconnect', onDrop);
      if (timer !== null) clearTimeout(timer);
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

  // Round lifecycle for the external analytics. The party number keys the
  // dedupe: a reconnect mid-round used to re-report round_started (a 4-player
  // table over-counted x4 on refreshes); now each browser reports each round
  // of a room exactly once. Progression events are per-player by design —
  // that is what the GameAnalytics Progression dashboard expects.
  const prevPhase = useRef<RoomStateView['phase'] | null>(null);
  const lastRoundKey = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevPhase.current;
    if (!view) return;
    prevPhase.current = view.phase;
    const mode = rulesPreset(view.rules) === 'classic' ? 'classic' : 'house';
    const bucket = view.seats.length <= 2 ? '2p' : '3-4p';
    if (view.phase === 'playing' && prev !== 'playing') {
      const roundNo = roundsPlayed(view.winTally) + 1;
      const key = `${view.roomCode}:${roundNo}`;
      if (lastRoundKey.current !== key) {
        lastRoundKey.current = key;
        if (roundNo === 1) track('game_start', { players: bucket });
        track('round_started', { round: roundNo, mode });
        trackProgression('Start', mode, bucket);
      }
    }
    if (view.phase === 'roundEnd' && prev === 'playing') {
      const won = view.winnerSeat === view.yourSeat;
      track('round_finished', { won, round: roundsPlayed(view.winTally) });
      trackProgression(won ? 'Complete' : 'Fail', mode, bucket);
    }
  }, [view?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // GA cohort dimensions: whether we host and which house rules the table
  // runs. Known only once seated; harmless to re-apply on every change.
  useEffect(() => {
    if (!view) return;
    const you = view.seats.find((s) => s.seat === view.yourSeat);
    setAnalyticsDimensions({ role: you?.isHost ? 'host' : 'guest', rules: view.rules });
  }, [view && `${view.yourSeat}:${rulesPreset(view.rules)}`]); // eslint-disable-line react-hooks/exhaustive-deps

  const join = (code: string, name?: string, pin?: string) => {
    const token = localStorage.getItem(tokenKey(code)) ?? undefined;
    if (!socket.connected) socket.connect();
    socket.emit('joinRoom', { code, name, token, pin }, (ack) => {
      if (!ack.ok || !ack.token) {
        const reason = ack.error ?? 'table_not_found';
        track('join_failed', { reason });
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
    <Ctx.Provider value={{
      view, error, joinError, rejection, selfDisconnected, effect,
      catchUp, dismissCatchUp: () => setCatchUp(null), join, actions,
    }}>
      {children}
    </Ctx.Provider>
  );
}
