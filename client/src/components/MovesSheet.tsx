// The room's move list, open on request and shut by default.
//
// The journal it reads has been on the server since the transaction log landed;
// the only thing missing was a way to ask for it during a live round. `catchUp`
// answers "what did I miss" once, on a reconnect, and only for the gap — this
// asks for the whole thing, and asking never moves the seat's pointer.
//
// Mounted outside the stage on purpose: the stage is transform-scaled, and a
// sheet inside it would be scaled with the felt instead of sitting beside it.
import { useEffect, useRef, useState } from 'react';
import type { CatchUpView } from '@uno/shared';
import { catchUpRows } from '../catchup';
import { useT } from '../i18n';
import { useStore } from '../store';

const clock = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function MovesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { actions, historyHead } = useStore();
  const { t, tn } = useT();
  const [data, setData] = useState<CatchUpView | null>(null);
  const list = useRef<HTMLOListElement | null>(null);
  const atBottom = useRef(true);

  // Refresh off the journal head, not off every snapshot: the head rises exactly
  // when something was written, so an idle table costs nothing.
  useEffect(() => {
    if (!open) return;
    let live = true;
    actions.getHistory((v) => { if (live) setData(v); });
    return () => { live = false; };
  }, [open, historyHead]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the newest row only while the reader is already at the bottom. A
  // panel that yanks itself down while someone is reading back has stolen their
  // place, and during a live round it would do it every move.
  useEffect(() => {
    const el = list.current;
    if (!el || !atBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [data]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const rows = data ? catchUpRows(data, t, tn) : [];
  const times = data ? data.entries.map((e) => e.atMs) : [];

  return (
    <aside className="moves-sheet" role="region" aria-label={t('moves.title')}>
      <header className="moves-head">
        <span className="moves-title">{t('moves.title')}</span>
        <span className="moves-count">{t('moves.kept', { n: rows.length })}</span>
        <button type="button" className="btn btn-ghost ghost-pill moves-close"
          aria-label={t('rules.close')} onClick={onClose}>×</button>
      </header>
      {data?.truncated && <p className="moves-trimmed">{t('moves.trimmed')}</p>}
      <ol className="moves-list" ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}>
        {rows.map((r, i) => (
          <li key={r.key}
            className={`moves-row${r.mine ? ' moves-mine' : ''}${r.boundary ? ' moves-boundary' : ''}`}>
            <span className="moves-text">{r.text}</span>
            {!r.boundary && times[i] !== undefined && (
              <span className="moves-time">{clock(times[i]!)}</span>
            )}
          </li>
        ))}
        {rows.length === 0 && <li className="moves-empty">{t('moves.empty')}</li>}
      </ol>
    </aside>
  );
}
