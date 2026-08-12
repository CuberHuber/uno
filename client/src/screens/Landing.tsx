import { useState } from 'react';
import type { Card } from '@uno/shared';
import CardFace from '../components/CardFace';
import { LangSwitcher, useT } from '../i18n';
import HostLink from './HostLink';

// The prototype's hero fan: red 8, blue 4, green +2.
const HERO: { card: Card; x: number; rot: number }[] = [
  { card: { id: -1, color: 'red', value: '8' }, x: 10, rot: -13 },
  { card: { id: -2, color: 'blue', value: '4' }, x: 128, rot: 4 },
  { card: { id: -3, color: 'green', value: 'draw2' }, x: 246, rot: 17 },
];

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
    <main className="landing">
      <div className="blob blob-a" />
      <div className="blob blob-b" />
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
        <div className="hero" aria-hidden="true">
          {HERO.map((h) => (
            <span key={h.card.id} className="hero-card" style={{ left: h.x, transform: `rotate(${h.rot}deg)` }}>
              <CardFace card={h.card} size="xl" />
            </span>
          ))}
        </div>
      </div>
    </main>
  );
}
