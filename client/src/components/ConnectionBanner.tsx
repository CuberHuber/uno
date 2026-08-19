import { useT } from '../i18n';
import { useStore } from '../store';

// Shown when OUR socket is down while we're seated at a table. PauseOverlay
// handles the mirror case (another player dropped); without this banner your
// own drop just froze the table silently.
export default function ConnectionBanner() {
  const { view, selfDisconnected } = useStore();
  const { t } = useT();
  if (!view || !selfDisconnected) return null;
  return (
    <div className="conn-banner" role="status" aria-live="polite">
      <span className="conn-dot" aria-hidden="true" />
      {t('conn.lost')}
    </div>
  );
}
