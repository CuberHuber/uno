import { useState } from 'react';
import type { Card } from '@uno/shared';
import CardFace from '../components/CardFace';
import HostLink from './HostLink';

// The prototype's hero fan: red 8, blue 4, green +2.
const HERO: { card: Card; x: number; rot: number }[] = [
  { card: { id: -1, color: 'red', value: '8' }, x: 10, rot: -13 },
  { card: { id: -2, color: 'blue', value: '4' }, x: 128, rot: 4 },
  { card: { id: -3, color: 'green', value: 'draw2' }, x: 246, rot: 17 },
];

export default function Landing() {
  const [code, setCode] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [token, setToken] = useState('');

  if (code) return <HostLink code={code} />;

  const createRoom = async () => {
    const res = await fetch('/api/rooms', { method: 'POST' });
    const body = (await res.json()) as { code: string };
    setCode(body.code);
  };

  if (joining) {
    return (
      <main className="centered">
        <div className="panel panel-pad join-card">
          <h2>Join a table</h2>
          <p className="card-sub">Paste the invite token your host sent you.</p>
          <form onSubmit={(e) => { e.preventDefault(); window.location.href = `/r/${token.trim()}`; }}>
            <div className="field">
              <label htmlFor="token">Invite token</label>
              <input id="token" className="input-pill input-token" value={token} placeholder="4K2P-9XVB"
                onChange={(e) => setToken(e.target.value)} autoFocus />
              <div className="hint-dot">Ask your host for the link — the token is the tail of it</div>
            </div>
            <button className="btn btn-primary btn-block btn-big" type="submit" disabled={!token.trim()}>
              Find the table
            </button>
          </form>
          <div className="card-backlink">
            <a href="#" onClick={(e) => { e.preventDefault(); setJoining(false); }}>Back to start</a>
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
        <div className="landing-note">No account needed — pick a name and play</div>
      </header>
      <div className="landing-main">
        <div className="landing-copy">
          <h1>Deal a game<br />in ten seconds.</h1>
          <p>Make a room, send the link, deal. Up to four at the table —
            classic rules, laptop or phone.</p>
          <div className="landing-ctas">
            <button className="btn btn-primary btn-big" onClick={createRoom}>Create a room</button>
            <button className="btn btn-secondary btn-solid btn-big" onClick={() => setJoining(true)}>
              I have an invite
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
