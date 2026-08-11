import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { fmtCode } from '../ui';

export default function Join({ code }: { code: string }) {
  const { join } = useStore();
  const [name, setName] = useState('');

  // A held seat (token in localStorage) rejoins without asking for a name.
  useEffect(() => {
    if (localStorage.getItem(`ochre:${code.toUpperCase()}`)) join(code);
  }, [code]);

  return (
    <main className="centered">
      <div className="panel panel-pad join-card">
        <h2>Join the table</h2>
        <p className="card-sub">Table {fmtCode(code.toUpperCase())} — pick a name and take a seat.</p>
        <form onSubmit={(e) => { e.preventDefault(); join(code, name); }}>
          <div className="field">
            <label htmlFor="name">Your name at the table</label>
            <input id="name" className="input-pill" value={name} maxLength={24}
              onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <button className="btn btn-primary btn-block btn-big" type="submit" disabled={!name.trim()}>
            Take a seat
          </button>
        </form>
      </div>
    </main>
  );
}
