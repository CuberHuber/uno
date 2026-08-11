import { useState } from 'react';
import HostLink from './HostLink';

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

  return (
    <main className="screen">
      <div className="brand-mark">8</div>
      <h1>Ochre Eights</h1>
      <p className="text-muted">
        Deal a game in ten seconds. Make a room, send the link —
        up to four at the table. No account needed.
      </p>
      {!joining ? (
        <>
          <button className="btn btn-primary" onClick={createRoom}>Create a room</button>
          <button className="btn btn-ghost" onClick={() => setJoining(true)}>I have an invite</button>
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); window.location.href = `/r/${token.trim()}`; }}>
          <div className="field">
            <label htmlFor="token">Invite token</label>
            <input id="token" className="input" value={token} placeholder="4K2P-9XVB"
              onChange={(e) => setToken(e.target.value)} autoFocus />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={!token.trim()}>
            Find the table
          </button>
        </form>
      )}
    </main>
  );
}
