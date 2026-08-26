import { catchUpRows } from '../catchup';
import { useT } from '../i18n';
import { useStore } from '../store';

// What happened while we were away, shown once on the way back in. It sits over
// whichever screen is up rather than inside the table, because the answer reads
// the same in the lobby, at the table and on the round-over screen — and
// because the table's own layout is somebody else's task.
//
// It never replaces the state: the snapshot has already arrived and been
// applied by the time this renders. This is the account, not the news.
export default function CatchUpSheet() {
  const { view, catchUp, dismissCatchUp } = useStore();
  const { t, tn } = useT();
  if (!view || !catchUp) return null;

  const rows = catchUpRows(catchUp, t, tn);
  return (
    <div className="dialog-backdrop catchup-backdrop" role="dialog" aria-modal="true">
      <div className="dialog">
        <div className="dialog-title">{t('catchup.title')}</div>
        <div className="dialog-body">
          {catchUp.truncated ? t('catchup.truncated') : t('catchup.sub')}
        </div>
        {/* A rematch inside the window is said out loud. Seat numbers before it
            belonged to other people, and a list that quietly glued the two
            halves together would be a lie told in a friendly voice. */}
        {catchUp.crossedRebuild && (
          <div className="dialog-body catchup-crossed">{t('catchup.crossed')}</div>
        )}
        {rows.length > 0 && (
          <ol className="catchup-list">
            {rows.map((r) => (
              <li
                key={r.key}
                className={`catchup-row${r.mine ? ' catchup-mine' : ''}${r.boundary ? ' catchup-boundary' : ''}`}
              >
                {r.text}
              </li>
            ))}
          </ol>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" onClick={dismissCatchUp}>
            {t('catchup.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
