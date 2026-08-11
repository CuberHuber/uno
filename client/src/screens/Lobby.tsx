import { useState } from 'react';
import RuleRow from '../components/RuleRow';
import { useStore } from '../store';
import { RULE_DEFS, fmtCode, initialOf, ruleChips, seatColor } from '../ui';

export default function Lobby() {
  const { view, actions } = useStore();
  const [copied, setCopied] = useState(false);
  if (!view) return null;

  const you = view.seats.find((s) => s.seat === view.yourSeat);
  const isHost = you?.isHost ?? false;
  const host = view.seats.find((s) => s.isHost);
  const link = `${window.location.origin}/r/${view.roomCode}`;
  const copy = () => {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <main className="lobby-screen">
      <header className="lobby-top">
        <div className="brand-mark brand-mark-sm">8</div>
        <div className="lobby-title">{host?.name}’s table</div>
        {ruleChips(view.rules).map((n) => <span key={n} className="chip">{n}</span>)}
        <span className="chip">{fmtCode(view.roomCode)}</span>
        <button className="btn btn-secondary btn-solid lobby-copy" onClick={copy}>
          {copied ? 'Copied' : 'Copy invite'}
        </button>
      </header>

      {isHost && (
        <div className="lobby-rules">
          {RULE_DEFS.map((r) => (
            <RuleRow key={r.key} name={r.name} desc={r.desc} on={view.rules[r.key]}
              onToggle={() => actions.setRules({ ...view.rules, [r.key]: !view.rules[r.key] })} />
          ))}
        </div>
      )}

      <div className="lobby-main">
        {view.seats.map((s) => (
          <div key={s.seat} className="seat-card">
            <span className="seat-avatar" style={{ background: seatColor(s.seat) }}>
              {initialOf(s.name)}
            </span>
            <div className="seat-name">{s.name}{s.seat === view.yourSeat ? ' (you)' : ''}</div>
            <span className="seat-status" style={{
              color: !s.connected ? 'var(--color-neutral-500)'
                : s.isHost ? 'var(--color-accent-700)' : 'var(--color-accent-2-700)',
            }}>
              {!s.connected ? 'away' : s.isHost ? 'Host' : 'Ready'}
            </span>
          </div>
        ))}
        {Array.from({ length: 4 - view.seats.length }, (_, i) => (
          <div key={`open-${i}`} className="seat-card seat-card-open">
            <span className="seat-avatar">+</span>
            <div className="seat-name">Seat open</div>
            <span className="seat-status">waiting</span>
          </div>
        ))}
      </div>

      <footer className="lobby-foot">
        <span className="lobby-note">
          {view.seats.length} of 4 seated{isHost && view.seats.length >= 2 ? ' · you can start any time' : ''}
        </span>
        {isHost
          ? <button className="btn btn-primary btn-big" disabled={view.seats.length < 2} onClick={actions.start}>
              Deal the first hand
            </button>
          : <span className="lobby-note">Waiting for the host to deal…</span>}
      </footer>
    </main>
  );
}
