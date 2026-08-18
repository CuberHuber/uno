import { useState } from 'react';
import { RULES_CATALOG, sanitizeRules, type Rules } from '@uno/shared';
import { track } from '../analytics';
import RuleRow from '../components/RuleRow';
import { useT } from '../i18n';

// Two phases: configure (rules + optional PIN, no room yet) → share (link).
export default function HostLink() {
  const { t, locale } = useT();
  const [rules, setRules] = useState<Rules>(sanitizeRules());
  const [pin, setPin] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pinOk = pin === '' || /^\d{4}$/.test(pin);

  const create = async () => {
    const res = await fetch('/api/rooms', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rules, pin: pin || undefined }),
    });
    const body = (await res.json()) as { code: string };
    track('room_created');
    setCode(body.code);
  };

  if (code) {
    const link = `${window.location.origin}/r/${code}`;
    const copy = () => {
      navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    };
    return (
      <main className="centered">
        <div className="panel host-card">
          <div className="host-head">
            <h2>{t('create.title')}</h2>
            <span className="tag tag-neutral">{t('create.hostTag')}</span>
          </div>
          <div className="label-sm">{t('create.linkLabel')}</div>
          <div className="invite-row">
            <div className="mono-pill">{link}</div>
            <button className="btn btn-primary" onClick={copy}>
              {copied ? t('create.copied') : t('create.copy')}
            </button>
          </div>
          <div className="host-foot">
            <span className="host-token">{t('create.token', { code })}</span>
            <a className="btn btn-primary btn-big" href={`/r/${code}`}>{t('create.open')}</a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="centered">
      <div className="panel host-card">
        <div className="host-head">
          <h2>{t('create.title')}</h2>
          <span className="tag tag-neutral">{t('create.hostTag')}</span>
        </div>
        <p className="card-sub">{t('create.sub')}</p>
        <div className="rulerows">
          {RULES_CATALOG.map((r) => (
            <RuleRow key={r.id} name={r.title[locale]} desc={r.tagline[locale]}
              details={r.details[locale]} on={rules[r.id]}
              onToggle={() => setRules({ ...rules, [r.id]: !rules[r.id] })} />
          ))}
        </div>
        <div className="host-divider" />
        <div className="field">
          <label htmlFor="pin">{t('create.pinLabel')}</label>
          <input id="pin" className="input-pill input-token" value={pin}
            inputMode="numeric" pattern="[0-9]*" maxLength={4} placeholder="····"
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          <div className="hint-dot">{t('create.pinHint')}</div>
        </div>
        <div className="host-foot">
          <span />
          <button className="btn btn-primary btn-big" disabled={!pinOk} onClick={create}>
            {t('create.createBtn')}
          </button>
        </div>
      </div>
    </main>
  );
}
