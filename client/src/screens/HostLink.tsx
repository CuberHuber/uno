import { useState } from 'react';
import type { Rules } from '@uno/shared';
import { CLASSIC_RULES } from '@uno/shared';
import RuleRow from '../components/RuleRow';
import { RULE_DEFS, fmtCode, rulesStashKey } from '../ui';

export default function HostLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [rules, setRules] = useState<Rules>({ ...CLASSIC_RULES });
  const link = `${window.location.origin}/r/${code}`;
  const copy = () => {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  const toggle = (key: keyof Rules) => {
    const next = { ...rules, [key]: !rules[key] };
    setRules(next);
    // Applied via setRules the moment you take your seat (see store.join).
    sessionStorage.setItem(rulesStashKey(code), JSON.stringify(next));
  };

  return (
    <main className="centered">
      <div className="panel host-card">
        <div className="host-head">
          <h2>House rules</h2>
          <span className="tag tag-neutral">You’re the host</span>
        </div>
        <p className="card-sub">Agree these before the first deal. They lock once the game starts.</p>
        <div className="rulerows">
          {RULE_DEFS.map((r) => (
            <RuleRow key={r.key} name={r.name} desc={r.desc} on={rules[r.key]}
              onToggle={() => toggle(r.key)} />
          ))}
        </div>
        <div className="host-divider" />
        <div className="label-sm">Invite link</div>
        <div className="invite-row">
          <div className="mono-pill">{link}</div>
          <button className="btn btn-primary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <div className="host-foot">
          <span className="host-token">Token {fmtCode(code)}</span>
          <a className="btn btn-primary btn-big" href={`/r/${code}`}>Open the room</a>
        </div>
      </div>
    </main>
  );
}
