import { useStore } from '../store';
import { initialOf, roundsPlayed, seatColor } from '../ui';

export default function RoundOver() {
  const { view, actions } = useStore();
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
      <h1>{youWon ? 'You take it' : `${winner?.name} takes it`}</h1>
      <p className="roundover-note">
        Round {roundsPlayed(view.winTally)} · {youWon ? 'you emptied your hand first' : `you finish with ${view.hand.length}`}
      </p>
      <div className="scoreboard">
        {ranked.map((s, i) => {
          const wins = view.winTally[s.seat] ?? 0;
          return (
            <div key={s.seat} className={`score-row${i === 0 ? ' score-row-first' : ''}`}>
              <span className="score-rank">{i + 1}</span>
              <span className="score-dot" style={{ background: seatColor(s.seat) }} />
              <span className="score-name">{s.name}{s.seat === view.yourSeat ? ' (you)' : ''}</span>
              <span className="score-left">{s.cardCount === 0 ? 'out' : `${s.cardCount} left`}</span>
              <span className="score-wins">{wins} {wins === 1 ? 'win' : 'wins'}</span>
            </div>
          );
        })}
      </div>
      <div className="hand-actions">
        <a className="btn btn-secondary btn-solid btn-big" href="/">Leave</a>
        <button className="btn btn-primary btn-big" onClick={actions.rematch}>Play again</button>
      </div>
    </main>
  );
}
