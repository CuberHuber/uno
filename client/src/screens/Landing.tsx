// Port of design/Ochre Eights - Landing Page.dc.html onto the real app.
//
// Sections: hero (full-bleed clip), how it works, house rules, see it, how the
// game plays, close. The create/join controls are pinned to the viewport rather
// than parked in the hero, so a visitor who decides at the rules is one tap from a
// room; the bar stays out of the way while the hero's own buttons are on screen.
//
// Rule prose comes from the shared catalogs, never from copy written here.
import { useEffect, useRef, useState } from 'react';
import { RULES_CATALOG } from '@uno/shared';
import { LangSwitcher, useT } from '../i18n';
import { cue, isMuted, setMuted, startMusic, stopMusic } from '../sound';
import HostLink from './HostLink';
import LandingRules from './LandingRules';

const SUITS = ['#c23b2e', '#e0a020', '#66923f', '#2e6f8a'];

/** Reveal on scroll: fade and lift, once, when the block first comes into view. */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) { setSeen(true); io.disconnect(); }
    }, { rootMargin: '0px 0px -12% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return { ref, className: `lp-rev${seen ? ' is-in' : ''}` };
}

/** A muted looping clip. The poster is its own first frame, so a slow load reads as
 *  a still of the game rather than as a hole in the page. */
function Clip({ name }: { name: string }) {
  return (
    <video poster={`/clips/${name}.jpg`}
      autoPlay muted loop playsInline preload="metadata" aria-hidden="true">
      <source src={`/clips/${name}.webm`} type="video/webm" />
      <source src={`/clips/${name}.mp4`} type="video/mp4" />
    </video>
  );
}

export default function Landing() {
  const { t, locale } = useT();
  const [creating, setCreating] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [code, setCode] = useState('');
  const [muted, setMutedState] = useState(isMuted);
  // Demo toggles. The landing shows what the switches do; the host sets the real
  // ones on the create screen.
  const [demo, setDemo] = useState([true, false, true, false]);
  const [heroCtaOn, setHeroCtaOn] = useState(true);

  const how = useReveal<HTMLDivElement>();
  const house = useReveal<HTMLDivElement>();
  const see = useReveal<HTMLDivElement>();
  const play = useReveal<HTMLDivElement>();

  const ctaRef = useRef<HTMLDivElement | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = ctaRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setHeroCtaOn(!!e?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => { if (joinOpen) codeRef.current?.focus(); }, [joinOpen]);

  if (creating) return <HostLink />;

  // The code is all we ask for here. Whether the room wants a PIN is something only
  // the server knows, and only once a join is attempted — so that step belongs to
  // the join screen behind /r/CODE, not to this bar.
  const go = () => {
    const c = code.trim().replace(/[\s-]/g, '').toUpperCase();
    if (c.length === 5) window.location.href = `/r/${c}`;
  };
  // The switch owns both halves of the audio layer. Turning it on is itself the
  // gesture the browser was waiting for, so the music may start on the same click.
  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (next) stopMusic(); else void startMusic();
  };

  const rules = RULES_CATALOG.map((r, i) => ({ ...r, suit: SUITS[i]!, on: demo[i]! }));
  const flip = (i: number) => setDemo((d) => d.map((v, k) => (k === i ? !v : v)));
  const barHidden = heroCtaOn && !joinOpen;

  return (
    <main className="lp">
      <header className="lp-head">
        <div className="lp-mark">8</div>
        <span className="lp-name">Ochre Eights</span>
        <div className="lp-head-right">
          <LangSwitcher />
          {/* One switch for the lot: the room's music and every cue at the table. */}
          <button type="button" className="btn btn-ghost" aria-pressed={!muted}
            onClick={toggleMute}>{muted ? '○' : '●'}</button>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hatch" />
        <Clip name="hero" />
        <div className="lp-hero-in">
          <div className="lp-hero-copy">
            <div className="lp-eyebrow">{t('landing.eyebrow')}</div>
            <h1>{t('landing.h1a')}<br />{t('landing.h1b')}</h1>
            <p>{t('landing.sub')}</p>
            <div className="lp-ctas" ref={ctaRef}>
              <button className="btn btn-primary btn-big" onClick={() => { cue('press'); setCreating(true); }}>
                {t('landing.create')}
              </button>
              <button className="btn btn-secondary btn-solid btn-big" onClick={() => setJoinOpen(true)}>
                {t('landing.joinCta')}
              </button>
            </div>
            <div className="lp-note">{t('landing.note')}</div>
          </div>

          <div className="lp-hero-side">
            <div className="lp-side-label">{t('landing.hostDecides')}</div>
            {rules.map((r) => (
              <div key={r.id} className="lp-chip">
                <span className="lp-dot" style={{ background: r.suit }} />
                <span className="lp-chip-name">{r.title[locale]}</span>
                <span className="lp-chip-state" style={{ color: r.on ? '#66923f' : 'var(--color-neutral-500)' }}>
                  {t(r.on ? 'house.on' : 'house.off')}
                </span>
              </div>
            ))}
            <a className="lp-jump" href="#rules">{t('landing.allRules')}</a>
          </div>
        </div>
      </section>

      <section className="lp-sec">
        <div ref={how.ref} className={how.className}>
          <h2>{t('how.title')}</h2>
          <div className="lp-steps">
            {(['1', '2', '3'] as const).map((n) => (
              <div key={n} className="lp-step">
                <div className="lp-step-n">{n}</div>
                <h3>{t(`how.s${n}t` as 'how.s1t')}</h3>
                <p>{t(`how.s${n}b` as 'how.s1b')}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-band" id="rules">
        <div ref={house.ref} className={`lp-band-in ${house.className}`}>
          <h2>{t('house.title')}</h2>
          <p className="lp-sub">{t('house.sub')}</p>
          <div className="lp-grid">
            {rules.map((r, i) => (
              <div key={r.id} className="lp-rule">
                <span className="lp-rule-bar" style={{ background: r.suit }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3>{r.title[locale]}</h3>
                  <p>{r.tagline[locale]}</p>
                </div>
                <button type="button" className="lp-switch" aria-pressed={r.on}
                  aria-label={r.title[locale]} onClick={() => flip(i)}
                  style={{ background: r.on ? '#66923f' : 'rgba(32,30,29,.22)' }}>
                  <span style={{ left: r.on ? 23 : 3 }} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-sec">
        <div ref={see.ref} className={see.className}>
          <h2>{t('see.title')}</h2>
          <div className="lp-clips">
            {(['turn', 'wild', 'lastcard'] as const).map((name, i) => (
              <figure key={name}>
                <div className="lp-clip">
                  <div className="lp-hatch" />
                  <Clip name={name} />
                </div>
                <figcaption>{t(`see.cap${i + 1}` as 'see.cap1')}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-sec">
        <div ref={play.ref} className={play.className}>
          <h2>{t('play.title')}</h2>
          <p className="lp-sub">{t('play.sub')}</p>
          <LandingRules />
        </div>
      </section>

      <section className="lp-close">
        <div className="lp-close-in">
          <div className="lp-close-mark">8</div>
          <h2>{t('close.title')}</h2>
          <p>{t('close.sub')}</p>
          <button className="btn btn-big" style={{ marginTop: 32, background: '#fffdf8', color: 'var(--color-text)' }}
            onClick={() => { cue('press'); setCreating(true); }}>{t('landing.create')}</button>
        </div>
      </section>

      <div className={`lp-bar${joinOpen ? ' is-open' : ''}`}
        style={{
          justifyContent: heroCtaOn ? 'flex-start' : 'flex-end',
          opacity: barHidden ? 0 : 1,
          transform: barHidden ? 'translateY(14px)' : 'none',
          visibility: barHidden ? 'hidden' : 'visible',
        }}>
        <div className="lp-bar-in">
          {!joinOpen ? (
            <div className="lp-bar-row">
              <button className="btn btn-primary" style={{ flex: 1, minHeight: 46 }}
                onClick={() => { cue('press'); setCreating(true); }}>{t('landing.create')}</button>
              <button className="btn btn-secondary btn-solid" style={{ minHeight: 46 }}
                onClick={() => setJoinOpen(true)}>{t('bar.join')}</button>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); go(); }}>
              <div className="lp-bar-head">
                <span className="lp-bar-label">{t('bar.roomCode')}</span>
                <button type="button" className="lp-bar-ghost"
                  onClick={() => { setJoinOpen(false); setCode(''); }}>{t('bar.cancel')}</button>
              </div>
              <div className="lp-bar-row">
                <input ref={codeRef} className="lp-code-input" value={code} maxLength={5} placeholder="ABCDE"
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setJoinOpen(false); setCode(''); } }} />
                <button className="btn btn-primary" type="submit" style={{ minHeight: 46 }}
                  disabled={code.length !== 5}>{t('bar.join')}</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
