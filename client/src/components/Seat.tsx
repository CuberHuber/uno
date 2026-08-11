import type { SeatView } from '@uno/shared';
import CardFace from './CardFace';

export default function Seat({ seat, active }: { seat: SeatView; active: boolean }) {
  return (
    <div className={`opp${active ? ' opp-active' : ''}`}>
      <div className="opp-fan">
        {Array.from({ length: Math.min(seat.cardCount, 5) }, (_, i) => (
          <CardFace key={i} back size="sm" />
        ))}
      </div>
      <div className="opp-pill">
        <span className="seat-avatar">{seat.name[0]?.toUpperCase()}</span>
        <span className="opp-name">{seat.name}</span>
        <span className="text-muted">
          {seat.cardCount}{seat.calledLastCard ? ' · called it' : ''}{!seat.connected ? ' · away' : ''}
        </span>
      </div>
    </div>
  );
}
