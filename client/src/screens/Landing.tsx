import { useState } from 'react';
import { LangSwitcher, useT } from '../i18n';
import HostLink from './HostLink';

/** The hero clip, playing full-bleed behind the copy.
 *
 *  It is the widened cut, not the square one: the recording is 2294x2242, and
 *  `object-fit: cover` on a landscape screen would crop the player chips off the
 *  top — the only thing on screen saying four people are at this table. The wide
 *  cut keeps the whole square and fills the gutters instead.
 *
 *  Muted and looping so browsers will autoplay it; the poster is the clip's own
 *  first frame, which makes a stalled load look deliberate rather than broken. */
function HeroClip() {
  return (
    <video poster="/clips/hero.jpg"
      autoPlay muted loop playsInline preload="metadata" aria-hidden="true">
      <source src="/clips/hero.webm" type="video/webm" />
      <source src="/clips/hero.mp4" type="video/mp4" />
    </video>
  );
}

export default function Landing() {
  const { t } = useT();
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [token, setToken] = useState('');

  if (creating) return <HostLink />;

  if (joining) {
    const go = () => {
      window.location.href = `/r/${token.trim().replace(/[\s-]/g, '').toUpperCase()}`;
    };
    return (
      <main className="centered">
        <div className="panel panel-pad join-card">
          <h2>{t('landing.joinTitle')}</h2>
          <p className="card-sub">{t('landing.joinSub')}</p>
          <form onSubmit={(e) => { e.preventDefault(); go(); }}>
            <div className="field">
              <label htmlFor="token">{t('landing.tokenLabel')}</label>
              <input id="token" className="input-pill input-token" value={token} placeholder="K7M3X"
                maxLength={7} onChange={(e) => setToken(e.target.value)} autoFocus />
              <div className="hint-dot">{t('landing.tokenHint')}</div>
            </div>
            <button className="btn btn-primary btn-block btn-big" type="submit" disabled={!token.trim()}>
              {t('landing.find')}
            </button>
          </form>
          <div className="card-backlink">
            <a href="#" onClick={(e) => { e.preventDefault(); setJoining(false); }}>{t('app.backToStart')}</a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="landing is-bleed">
      <div className="landing-bleed"><HeroClip /></div>
      <header className="landing-top">
        <div className="brand-mark">8</div>
        <div className="brand-name">Ochre Eights</div>
        <div className="landing-note">{t('landing.note')}</div>
        <LangSwitcher />
      </header>
      <div className="landing-main">
        <div className="landing-copy">
          <h1>{t('landing.h1a')}<br />{t('landing.h1b')}</h1>
          <p>{t('landing.sub')}</p>
          <div className="landing-ctas">
            <button className="btn btn-primary btn-big" onClick={() => setCreating(true)}>
              {t('landing.create')}
            </button>
            <button className="btn btn-secondary btn-solid btn-big" onClick={() => setJoining(true)}>
              {t('landing.haveInvite')}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
