import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { useStore } from '../store';
import { fmtCode } from '../ui';

export default function Join({ code }: { code: string }) {
  const { join, joinError } = useStore();
  const { t, terr } = useT();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');

  // A held seat (token in localStorage) rejoins without asking for a name.
  useEffect(() => {
    if (localStorage.getItem(`ochre:${code.toUpperCase()}`)) join(code);
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  const pinStep = joinError === 'pin_required' || joinError === 'wrong_pin';

  if (pinStep) {
    return (
      <main className="centered">
        <div className="panel panel-pad join-card">
          <h2>{t('join.pinTitle')}</h2>
          <p className="card-sub">{t('join.sub', { code: fmtCode(code.toUpperCase()) })}</p>
          <form onSubmit={(e) => { e.preventDefault(); join(code, name || undefined, pin); }}>
            <div className="field">
              <label htmlFor="pin">{t('join.pinLabel')}</label>
              <input id="pin" className="input-pill input-token" value={pin}
                inputMode="numeric" pattern="[0-9]*" maxLength={4} autoFocus
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
              {joinError === 'wrong_pin' && <div className="hint-dot">{terr('wrong_pin')}</div>}
            </div>
            <button className="btn btn-primary btn-block btn-big" type="submit"
              disabled={!/^\d{4}$/.test(pin)}>
              {t('join.pinGo')}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="centered">
      <div className="panel panel-pad join-card">
        <h2>{t('join.title')}</h2>
        <p className="card-sub">{t('join.sub', { code: fmtCode(code.toUpperCase()) })}</p>
        <form onSubmit={(e) => { e.preventDefault(); join(code, name); }}>
          <div className="field">
            <label htmlFor="name">{t('join.nameLabel')}</label>
            <input id="name" className="input-pill" value={name} maxLength={24}
              onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <button className="btn btn-primary btn-block btn-big" type="submit" disabled={!name.trim()}>
            {t('join.sit')}
          </button>
        </form>
        {joinError && !pinStep && <div className="hint-dot">{terr(joinError)}</div>}
      </div>
    </main>
  );
}
