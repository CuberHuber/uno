// Surface 1 of sub-project E: the slide shown before the round.
//
// Not a tutorial — a short, shared agreement about what THIS table does, read in
// the ten seconds before the deal. Everyone thinks they know UNO and no two of them
// agree, so the slide states the base game once and then names only the house rules
// the host actually switched on: a player at a table without stacking should never
// have to read about pots.
//
// Taglines only, never `details`. The one-liner is the whole point of this screen;
// the full text belongs to the in-game help, which the player opens when the
// one-liner was not enough.
//
// As on the landing, no prose is written here. Every line comes from BASICS_CATALOG
// and RULES_CATALOG, so a rule reworded in the engine cannot leave a stale
// explanation behind — and both languages arrive for free.
import { useEffect, useRef } from 'react';
import { BASICS_CATALOG, RULES_CATALOG, type Rules } from '@uno/shared';
import { useT } from '../i18n';
import { activeRules } from '../ui';

/** Once per browser per room. A rematch in the same room is silent; a new room
 *  speaks up again. Same `ochre:` namespace as the seat token (`ochre:CODE`), the
 *  locale (`ochre:locale`) and the mute flag (`ochre:muted`); the `slide:` segment
 *  keeps it clear of the bare-code token key. */
const seenKey = (code: string) => `ochre:slide:${code.toUpperCase()}`;

/** Has this browser already been shown the slide for this room?
 *  A browser that refuses storage (private mode, blocked cookies) must not take the
 *  table down with it — it simply reads as "not seen" and gets the slide again. */
export function hasSeenSlide(code: string): boolean {
  try {
    return localStorage.getItem(seenKey(code)) !== null;
  } catch {
    return false;
  }
}

/** Remember that it was shown. Call it when the slide is dismissed. */
export function markSlideSeen(code: string): void {
  try {
    localStorage.setItem(seenKey(code), '1');
  } catch {
    // Nothing to remember, but nothing to break either: the slide shows once more.
  }
}

/** The four suit colours, in catalog order — the same ones the landing gives the
 *  house rules, so a rule keeps its colour from the landing chip through to here.
 *  Only house rules get a dot: six basics cycling four colours would look like a
 *  code and mean nothing, and it would blunt the one place colour does carry sense. */
const SUITS = ['#c23b2e', '#e0a020', '#66923f', '#2e6f8a'];

export default function RulesSlide({ rules, onDismiss }: {
  rules: Rules;
  onDismiss: () => void;
}) {
  const { t, locale } = useT();
  const panel = useRef<HTMLDivElement | null>(null);
  const house = activeRules(rules);

  // The panel takes focus as it opens, so Tab walks the slide rather than the table
  // still sitting underneath it.
  useEffect(() => { panel.current?.focus(); }, []);

  // Escape dismisses. A window listener rather than a handler on the panel: focus
  // can wander (a click on the scrim, an extension stealing it) and Escape should
  // still work. Dismissing is whatever the caller does — no exit animation, because
  // nobody impatient should have to sit through one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return (
    <div className="rp-scrim">
      {/* A dialog, but deliberately not `aria-modal`: the round is already running
          behind this — the server dealt the moment the host asked — and the slide
          steps aside on its own when the turn arrives. Claiming modality would both
          lie to a screen reader and promise a focus trap this does not want. */}
      <div className="rp-panel" ref={panel} tabIndex={-1}
        role="dialog" aria-labelledby="rp-slide-title">
        <h2 className="rp-title" id="rp-slide-title">{t('rules.slideTitle')}</h2>
        <p className="rp-sub">{t('rules.slideSub')}</p>

        <div className="rp-cols">
          <section className="rp-sec">
            <h3>{t('rules.basics')}</h3>
            <ul className="rp-list">
              {BASICS_CATALOG.map((b) => (
                <li key={b.id} className="rp-item">
                  <div>
                    <div className="rp-item-t">
                      {b.title[locale]}
                      {/* The one place we leave official UNO — tagged here exactly as the
                          landing tags it, or a veteran reads the opening as a bug. */}
                      {b.id === 'opening' && <>{' '}<span className="rp-tag">{t('play.ourRule')}</span></>}
                    </div>
                    <p className="rp-item-b">{b.tagline[locale]}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="rp-sec">
            <h3>{t('rules.atThisTable')}</h3>
            {house.length === 0 ? (
              // Nothing switched on: one sentence, not four "off" lines. A rule that
              // is off is not news, and listing it invites an argument about it.
              <p className="rp-classic">{t('rules.classicLine')}</p>
            ) : (
              <ul className="rp-list">
                {house.map((r) => (
                  <li key={r.id} className="rp-item">
                    {/* Coloured by position in the full catalog, not in this filtered
                        list, so stacking stays red whichever rules travel with it. */}
                    <span className="rp-dot" style={{ background: SUITS[RULES_CATALOG.indexOf(r)] }} />
                    <div>
                      {/* Stated in the affirmative: the catalog title and tagline say what
                          happens at the table, never that a switch is "enabled". */}
                      <div className="rp-item-t">{r.title[locale]}</div>
                      <p className="rp-item-b">{r.tagline[locale]}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* One control, no steps. A second screen would be a second thing to dismiss. */}
        <div className="rp-foot">
          <button type="button" className="btn btn-primary btn-big" onClick={onDismiss}>
            {t('rules.gotIt')}
          </button>
        </div>
      </div>
    </div>
  );
}
