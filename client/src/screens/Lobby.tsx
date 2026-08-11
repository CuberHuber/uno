import { useStore } from '../store';

export default function Lobby() {
  const { view, actions } = useStore();
  if (!view) return null;
  const you = view.seats.find((s) => s.seat === view.yourSeat);
  const isHost = you?.isHost ?? false;
  const link = `${window.location.origin}/r/${view.roomCode}`;

  return (
    <main className="screen">
      <div className="brand-mark">8</div>
      <h2>{view.seats.find((s) => s.isHost)?.name}’s table</h2>
      <button className="btn btn-ghost" onClick={() => navigator.clipboard.writeText(link)}>
        Copy invite · {view.roomCode}
      </button>
      <ul className="lobby-seats">
        {view.seats.map((s) => (
          <li key={s.seat} className="lobby-seat">
            <span className="seat-avatar">{s.name[0]?.toUpperCase()}</span>
            <span>{s.name}{s.seat === view.yourSeat ? ' (you)' : ''}</span>
            {s.isHost && <span className="tag tag-accent">Host</span>}
            {!s.connected && <span className="tag tag-neutral">away</span>}
          </li>
        ))}
        {Array.from({ length: 4 - view.seats.length }, (_, i) => (
          <li key={`open-${i}`} className="lobby-seat lobby-seat-open">
            <span className="seat-avatar">+</span><span>Seat open</span>
          </li>
        ))}
      </ul>
      {isHost ? (
        <button className="btn btn-primary" disabled={view.seats.length < 2} onClick={actions.start}>
          Deal the first hand
        </button>
      ) : (
        <p className="text-muted">Waiting for the host to deal…</p>
      )}
      <p className="text-muted">{view.seats.length} of 4 seated</p>
    </main>
  );
}
