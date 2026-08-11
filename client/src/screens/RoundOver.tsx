import { useStore } from '../store';

export default function RoundOver() {
  const { view, actions } = useStore();
  if (!view) return null;
  const winner = view.seats.find((s) => s.seat === view.winnerSeat);
  const ranked = [...view.seats].sort((a, b) => a.cardCount - b.cardCount);
  return (
    <main className="screen">
      <div className="seat-avatar seat-avatar-big">{winner?.name[0]?.toUpperCase()}</div>
      <h1>{winner?.seat === view.yourSeat ? 'You take it' : `${winner?.name} takes it`}</h1>
      <table className="table roundover-table">
        <tbody>
          {ranked.map((s) => (
            <tr key={s.seat}>
              <td>{s.name}{s.seat === view.yourSeat ? ' (you)' : ''}</td>
              <td>{s.cardCount === 0 ? 'out' : `${s.cardCount} left`}</td>
              <td>{view.winTally[s.seat] ?? 0} {view.winTally[s.seat] === 1 ? 'win' : 'wins'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hand-actions">
        <a className="btn btn-secondary" href="/">Leave</a>
        <button className="btn btn-primary" onClick={actions.rematch}>Play again</button>
      </div>
    </main>
  );
}
