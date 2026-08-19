import { useState } from 'react';
import { RULES_CATALOG } from '@uno/shared';
import { track } from '../analytics';
import RuleRow from '../components/RuleRow';
import { LangSwitcher, useT } from '../i18n';
import { useStore } from '../store';
import { fmtCode, initialOf, ruleChips, seatColor } from '../ui';

export default function Lobby() {
  const { view, actions } = useStore();
  const { t, locale } = useT();
  const [copied, setCopied] = useState(false);
  const [pinDraft, setPinDraft] = useState('');
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
  const chips = ruleChips(view.rules, locale);

  return (
    <main className="lobby-screen">
      <header className="lobby-top">
        <div className="brand-mark brand-mark-sm">8</div>
        <div className="lobby-title">{t('lobby.tableOf', { name: host?.name ?? '' })}</div>
        {(chips.length ? chips : [t('rules.classic')]).map((n) => <span key={n} className="chip">{n}</span>)}
        {view.hasPin && !isHost && <span className="chip">PIN</span>}
        <span className="chip">{fmtCode(view.roomCode)}</span>
        <LangSwitcher />
        <button className="btn btn-secondary btn-solid lobby-copy" onClick={copy}>
          {copied ? t('lobby.copied') : t('lobby.copy')}
        </button>
      </header>

      {isHost && (
        <div className="lobby-rules">
          {RULES_CATALOG.map((r) => (
            <RuleRow key={r.id} name={r.title[locale]} desc={r.tagline[locale]}
              details={r.details[locale]} on={view.rules[r.id]}
              onToggle={() => {
                track('rules_toggle', { rule: r.id, on: !view.rules[r.id], where: 'lobby' });
                actions.setRules({ ...view.rules, [r.id]: !view.rules[r.id] });
              }} />
          ))}
          <div className="pin-row">
            {view.pin !== null ? (
              <>
                <span className="chip">{t('lobby.pinChip', { pin: view.pin })}</span>
                <button className="btn btn-ghost" onClick={() => actions.setPin(null)}>
                  {t('lobby.pinRemove')}
                </button>
              </>
            ) : (
              <>
                <input className="input-pill input-token pin-input" value={pinDraft}
                  inputMode="numeric" pattern="[0-9]*" maxLength={4} placeholder="····"
                  onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, ''))} />
                <button className="btn btn-secondary btn-solid" disabled={!/^\d{4}$/.test(pinDraft)}
                  onClick={() => { actions.setPin(pinDraft); setPinDraft(''); }}>
                  {t('lobby.pinSet')}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="lobby-main">
        {view.seats.map((s) => (
          <div key={s.seat} className="seat-card">
            <span className="seat-avatar" style={{ background: seatColor(s.seat) }}>
              {initialOf(s.name)}
            </span>
            <div className="seat-name">{s.name}{s.seat === view.yourSeat ? ` ${t('lobby.you')}` : ''}</div>
            <span className="seat-status" style={{
              color: !s.connected ? 'var(--color-neutral-500)'
                : s.isHost ? 'var(--color-accent-700)' : 'var(--color-accent-2-700)',
            }}>
              {!s.connected ? t('lobby.away') : s.isHost ? t('lobby.host') : t('lobby.ready')}
            </span>
          </div>
        ))}
        {Array.from({ length: 4 - view.seats.length }, (_, i) => (
          <div key={`open-${i}`} className="seat-card seat-card-open">
            <span className="seat-avatar">+</span>
            <div className="seat-name">{t('lobby.seatOpen')}</div>
            <span className="seat-status">{t('lobby.waiting')}</span>
          </div>
        ))}
      </div>

      <footer className="lobby-foot">
        <span className="lobby-note">
          {t('lobby.seated', { n: view.seats.length })}
          {isHost && view.seats.length >= 2 ? t('lobby.canStart') : ''}
        </span>
        {isHost
          ? <button className="btn btn-primary btn-big" disabled={view.seats.length < 2} onClick={actions.start}>
              {t('lobby.deal')}
            </button>
          : <span className="lobby-note">{t('lobby.waitHost')}</span>}
      </footer>
    </main>
  );
}
