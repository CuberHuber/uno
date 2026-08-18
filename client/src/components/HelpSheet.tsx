// Surface 2 of sub-project E — the in-game help, hidden by default.
//
// It never opens on its own. The table mounts it closed and nothing but the "?"
// beside the rule chips ever sets `open`: no first-run popover, no tooltip pointing
// at it. A player who already knows the rules finishes the round without meeting it.
//
// The prose is NOT written here. This table's house rules come from RULES_CATALOG
// through activeRules, the base game from BASICS_CATALOG, and both are read as
// `details` rather than `tagline` — the one-liner is what the lobby chips and the
// pre-round slide already said, and it was not enough or nobody would be here.
// Reading from the catalogs is also how both languages arrive for free.
//
// The shell (.rp-*) is shared with the pre-round slide; it lives in game.css.
import { useEffect, useRef } from 'react';
import { BASICS_CATALOG, RULES_CATALOG, type Rules } from '@uno/shared';
import { useT } from '../i18n';
import { activeRules } from '../ui';

/** Suit dots in catalog order, exactly as the landing colours them: a rule keeps its
 *  own colour whether or not this table switched it on, so the dot beside "Pass the
 *  penalty" is the same red everywhere it is explained. Only house rules are dotted —
 *  six basics cycling four colours would read as a code that does not exist. */
const SUITS = ['#c23b2e', '#e0a020', '#66923f', '#2e6f8a'];
const suitOfRule = (id: string) => SUITS[RULES_CATALOG.findIndex((c) => c.id === id) % SUITS.length]!;

export default function HelpSheet({ open, rules, onClose }: {
  open: boolean; rules: Rules; onClose: () => void;
}) {
  const { t, locale } = useT();
  const panel = useRef<HTMLDivElement>(null);
  // onClose is read through a ref so the effect below can depend on `open` alone.
  // The table re-renders on every card that moves; a fresh onClose identity each time
  // would re-run the effect and yank focus back to the panel mid-sentence.
  const close = useRef(onClose);
  close.current = onClose;

  // Open: the panel takes focus. Close: it goes back to whatever opened it — the "?".
  // Escape is bound to the document rather than the panel so it still works after the
  // reader has tabbed to the Close button, or anywhere else.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;
  const house = activeRules(rules);

  return (
    // The sheet is presentation only: it holds no game state, sends nothing to the
    // server and unmounts back to exactly the table it covered. The round keeps
    // running underneath while it is open.
    <div className="rp-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {/* aria-modal is deliberately left off: the game behind this is still being
          played, and a screen reader should not be told the table went away. */}
      <div className="rp-panel" role="dialog" aria-label={t('rules.helpOpen')} tabIndex={-1} ref={panel}>
        <h2 className="rp-title">{t('rules.helpOpen')}</h2>
        <div className="rp-cols">
          {/* This table first. The player opened help to settle an argument about the
              house rules, not to be taught what a Skip does. */}
          <section className="rp-sec">
            <h3>{t('rules.atThisTable')}</h3>
            {house.length === 0 ? (
              <p className="rp-classic">{t('rules.classicLine')}</p>
            ) : (
              <ul className="rp-list">
                {house.map((r) => (
                  <li key={r.id} className="rp-item">
                    <span className="rp-dot" style={{ background: suitOfRule(r.id) }} />
                    <div>
                      <div className="rp-item-t">{r.title[locale]}</div>
                      <p className="rp-item-b">{r.details[locale]}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rp-sec">
            <h3>{t('rules.basics')}</h3>
            <ul className="rp-list">
              {BASICS_CATALOG.map((b) => (
                <li key={b.id} className="rp-item">
                  <div>
                    <div className="rp-item-t">
                      {b.title[locale]}
                      {/* The one place the game leaves official UNO, tagged the way the
                          landing tags it — unlabelled, a veteran reads it as a bug. */}
                      {b.id === 'opening' && <> <span className="rp-tag">{t('play.ourRule')}</span></>}
                    </div>
                    <p className="rp-item-b">{b.details[locale]}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <div className="rp-foot">
          <button type="button" className="btn btn-primary" onClick={onClose}>{t('rules.close')}</button>
        </div>
      </div>
    </div>
  );
}
