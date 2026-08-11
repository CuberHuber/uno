import type { SeatView } from '@uno/shared';
import CardFace from './CardFace';
import { initialOf, seatColor } from '../ui';

// Fan geometry from the prototype: overlap tightens and splay widens as the hand grows.
const fan = (n: number) => {
  const ml = -(16 + Math.min(Math.max(0, n - 4) * 1.8, 7));
  return Array.from({ length: n }, (_, i) => ({
    marginLeft: i === 0 ? 0 : ml,
    transform: `rotate(${((i - (n - 1) / 2) * (n > 4 ? 2.6 : 1.6)).toFixed(2)}deg)`,
  }));
};

export default function Seat({ seat, active }: { seat: SeatView; active: boolean }) {
  const called = seat.calledLastCard && seat.cardCount === 1;
  return (
    <div className={`opp${active ? ' opp-active' : ''}`}>
      <div className="opp-fan">
        {fan(seat.cardCount).map((s, i) => (
          <span key={i} className="fan-slot" style={s}><CardFace back size="sm" /></span>
        ))}
      </div>
      <div className="opp-pill">
        <span className="seat-avatar" style={{ background: seatColor(seat.seat) }}>
          {initialOf(seat.name)}
        </span>
        <span className="opp-name">{seat.name}</span>
        <span className={`opp-count${called ? ' opp-called' : ''}`}>
          {called ? '1 — called it' : seat.cardCount}{!seat.connected ? ' · away' : ''}
        </span>
      </div>
    </div>
  );
}
