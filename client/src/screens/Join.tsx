import { useEffect, useState } from 'react';
import { useStore } from '../store';

export default function Join({ code }: { code: string }) {
  const { join } = useStore();
  const [name, setName] = useState('');

  // A held seat (token in localStorage) rejoins without asking for a name.
  useEffect(() => {
    if (localStorage.getItem(`ochre:${code.toUpperCase()}`)) join(code);
  }, [code]);

  return (
    <main className="screen">
      <div className="brand-mark">8</div>
      <h2>Join the table</h2>
      <form onSubmit={(e) => { e.preventDefault(); join(code, name); }}>
        <div className="field">
          <label htmlFor="name">Your name at the table</label>
          <input id="name" className="input" value={name} maxLength={24}
            onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <button className="btn btn-primary btn-block" type="submit" disabled={!name.trim()}>
          Take a seat
        </button>
      </form>
    </main>
  );
}
