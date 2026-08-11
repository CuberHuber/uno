import { useEffect, useState } from 'react';
import { useStore } from '../store';

const GRACE_MS = 120_000; // mirrors CONTINUE_GRACE_MS on the server

export default function PauseOverlay() {
  const { view, actions } = useStore();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!view?.paused) return null;

  const awaySeat = view.seats.find((s) => !s.connected);
  const waitedMs = view.pausedSinceMs === null ? 0 : now - view.pausedSinceMs;
  const graceOver = waitedMs >= GRACE_MS;

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <div className="dialog-title">Waiting for {view.pausedForName}…</div>
        <div className="dialog-body">
          Their seat is held — the game resumes the moment they reopen the link.
        </div>
        {graceOver && awaySeat && (
          <div className="dialog-actions">
            <button className="btn btn-primary" onClick={() => actions.continueWithout(awaySeat.seat)}>
              Continue without them
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
