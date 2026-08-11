import { useState } from 'react';
import { isPlayable, type Card } from '@uno/shared';
import CardFace from '../components/CardFace';
import ColorPicker from '../components/ColorPicker';
import Seat from '../components/Seat';
import { useStore } from '../store';

const COLOR_NAME = { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue' } as const;

export default function Table() {
  const { view, actions, rejection } = useStore();
  const [wildCardId, setWildCardId] = useState<number | null>(null);
  if (!view || !view.topCard) return null;

  const yourTurn = view.turnSeat === view.yourSeat;
  const opponents = view.seats.filter((s) => s.seat !== view.yourSeat);
  // 1 opponent → top; 2 → left+right; 3 → left+top+right (matches the Sunroom mockup).
  const slots: Record<number, string[]> = { 1: ['top'], 2: ['left', 'right'], 3: ['left', 'top', 'right'] };
  const slotNames = slots[opponents.length] ?? ['top'];

  const turnName = view.turnSeat === null ? '' :
    view.turnSeat === view.yourSeat ? 'your turn' :
    `${view.seats.find((s) => s.seat === view.turnSeat)?.name}’s turn`;
  const banner = view.currentColor
    ? `${COLOR_NAME[view.currentColor]} is live · ${turnName}`
    : `Pick a color · ${turnName}`;

  const canPlay = (c: Card) =>
    yourTurn && !view.mustChooseColor &&
    (view.pendingDrawnCardId === null || view.pendingDrawnCardId === c.id) &&
    isPlayable(c, view.topCard!, view.currentColor);

  const playCard = (c: Card) => {
    if (c.value === 'wild' || c.value === 'wild4') setWildCardId(c.id);
    else actions.play(c.id);
  };

  const canCall = (yourTurn && view.hand.length <= 2) || view.catchableSeat === view.yourSeat;
  const canCatch = view.catchableSeat !== null && view.catchableSeat !== view.yourSeat;

  return (
    <main className="table-screen">
      <div className="table-felt">
        {opponents.map((s, i) => (
          <div key={s.seat} className={`opp-slot opp-slot-${slotNames[i]}`}>
            <Seat seat={s} active={view.turnSeat === s.seat} />
          </div>
        ))}
        <div className="stage">
          <CardFace back size="lg" onClick={yourTurn && view.pendingDrawnCardId === null ? actions.draw : undefined} />
          <CardFace card={view.topCard} size="lg" />
          <span className="live-dot" style={{ background: view.currentColor ? `var(--card-${view.currentColor})` : '#3b352d' }} />
        </div>
        <div className="banner">{rejection ?? banner}</div>
      </div>

      <div className="hand-dock">
        <div className="hand">
          {view.hand.map((c) => (
            <CardFace key={c.id} card={c}
              playable={canPlay(c)}
              raised={view.pendingDrawnCardId === c.id}
              onClick={canPlay(c) ? () => playCard(c) : undefined} />
          ))}
        </div>
        <div className="hand-actions">
          <span className="opp-pill">
            <span className="seat-avatar">{view.seats.find((s) => s.seat === view.yourSeat)?.name[0]?.toUpperCase()}</span>
            <strong>You</strong>
            <span className="text-muted">{view.hand.length} cards</span>
          </span>
          {view.pendingDrawnCardId !== null
            ? <button className="btn btn-secondary" onClick={actions.pass}>Keep it</button>
            : <button className="btn btn-secondary" disabled={!yourTurn} onClick={actions.draw}>Draw</button>}
          {canCatch
            ? <button className="btn btn-primary" onClick={actions.catchCall}>Catch</button>
            : <button className="btn btn-primary" disabled={!canCall} onClick={actions.call}>Call “last card”</button>}
        </div>
      </div>

      {view.mustChooseColor && <ColorPicker title="The flip was wild — pick the color" onPick={actions.chooseColor} />}
      {wildCardId !== null && (
        <ColorPicker title="Pick the color" onPick={(c) => { actions.play(wildCardId, c); setWildCardId(null); }} />
      )}
    </main>
  );
}
