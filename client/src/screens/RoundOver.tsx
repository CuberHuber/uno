import { useT } from '../i18n';
import { useStore } from '../store';
import { initialOf, roundsPlayed, seatColor } from '../ui';

export default function RoundOver() {
  const { view, actions } = useStore();
  const { t } = useT();
  if (!view) return null;

  const winner = view.seats.find((s) => s.seat === view.winnerSeat);
  const youWon = winner?.seat === view.yourSeat;
  const ranked = [...view.seats].sort((a, b) => a.cardCount - b.cardCount);

  return (
    <main className="screen roundover">
      <div className="seat-avatar winner-avatar"
        style={winner ? { background: seatColor(winner.seat) } : undefined}>
        {initialOf(winner?.name)}
      </div>
      <h1>{youWon ? t('over.youTake') : t('over.takes', { name: winner?.name ?? '' })}</h1>
      <p className="roundover-note">
        {t('over.round', { n: roundsPlayed(view.winTally) })} · {youWon ? t('over.youEmptied') : t('over.finishWith', { n: view.hand.length })}
      </p>
      <div className="scoreboard">
        {ranked.map((s, i) => {
          const wins = view.winTally[s.seat] ?? 0;
          return (
            <div key={s.seat} className={`score-row${i === 0 ? ' score-row-first' : ''}`}>
              <span className="score-rank">{i + 1}</span>
              <span className="score-dot" style={{ background: seatColor(s.seat) }} />
              <span className="score-name">{s.name}{s.seat === view.yourSeat ? ` ${t('lobby.you')}` : ''}</span>
              <span className="score-left">{s.cardCount === 0 ? t('over.out') : t('over.left', { n: s.cardCount })}</span>
              <span className="score-wins">{wins} {wins === 1 ? t('over.win') : t('over.wins')}</span>
            </div>
          );
        })}
      </div>
      <div className="hand-actions">
        <a className="btn btn-secondary btn-solid btn-big" href="/">{t('over.leave')}</a>
        <button className="btn btn-primary btn-big" onClick={actions.rematch}>{t('over.again')}</button>
      </div>
    </main>
  );
}
