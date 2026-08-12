import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { useStore } from '../store';

const GRACE_MS = 120_000; // mirrors CONTINUE_GRACE_MS on the server

export default function PauseOverlay() {
  const { view, actions } = useStore();
  const { t } = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!view?.paused) return null;

  const awaySeat = view.seats.find((s) => !s.connected);
  const waitedMs = view.pausedSinceMs === null ? 0 : now - view.pausedSinceMs;
  const graceOver = waitedMs >= GRACE_MS;

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <div className="dialog-title">{t('pause.waiting', { name: view.pausedForName ?? '' })}</div>
        <div className="dialog-body">{t('pause.body')}</div>
        {graceOver && awaySeat && (
          <div className="dialog-actions">
            <button className="btn btn-primary" onClick={() => actions.continueWithout(awaySeat.seat)}>
              {t('pause.continue')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
