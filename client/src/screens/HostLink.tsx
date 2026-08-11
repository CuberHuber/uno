import { useState } from 'react';
import { fmtCode } from '../ui';

export default function HostLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
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
          <h2>Your table is ready</h2>
          <span className="tag tag-neutral">You’re the host</span>
        </div>
        <p className="card-sub">Classic rules, 2–4 players. Send the link, then open the room.</p>
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
