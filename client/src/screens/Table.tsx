import { useState } from 'react';
import { isPlayable, type Card } from '@uno/shared';
import CardFace from '../components/CardFace';
import ColorPicker from '../components/ColorPicker';
import PauseOverlay from '../components/PauseOverlay';
import Seat from '../components/Seat';
import { useStore } from '../store';
import { initialOf, roundsPlayed, ruleChips, seatColor } from '../ui';

export default function Table() {
  const { view, actions, rejection } = useStore();
  const [wildCardId, setWildCardId] = useState<number | null>(null);
  if (!view || !view.topCard) return null;

  const yourTurn = view.turnSeat === view.yourSeat;
  const you = view.seats.find((s) => s.seat === view.yourSeat);
  const host = view.seats.find((s) => s.isHost);
  const opponents = view.seats.filter((s) => s.seat !== view.yourSeat);
  // 1 opponent → top; 2 → left+right; 3 → left+top+right (positions from the prototype).
  const slots: Record<number, string[]> = { 1: ['top'], 2: ['left', 'right'], 3: ['left', 'top', 'right'] };
  const slotNames = slots[opponents.length] ?? ['top'];

  const turnName = view.seats.find((s) => s.seat === view.turnSeat)?.name;
  const banner = !view.currentColor
    ? 'The flip was wild — pick the colour'
    : view.pendingDraw > 0
      ? yourTurn
        ? `Answer the +${view.pendingDraw} — stack or take it`
        : `${turnName} must answer +${view.pendingDraw}`
      : yourTurn
        ? `Your turn — ${view.currentColor} is live`
        : `${turnName}’s turn · ${view.currentColor} is live`;

  const canPlay = (c: Card) =>
    yourTurn && !view.mustChooseColor &&
    (view.pendingDrawnCardId === null || view.pendingDrawnCardId === c.id) &&
    (view.pendingDraw > 0
      ? c.value === 'draw2' || c.value === 'wild4' // stacking: only an answer card goes down
      : isPlayable(c, view.topCard!, view.currentColor));
  const canDraw = yourTurn && view.pendingDrawnCardId === null && !view.mustChooseColor;

  // Force play: a drawn playable wild is held as pendingDrawn until the colour lands.
  const forcedWildId = view.rules.forcePlay && view.pendingDrawnCardId !== null &&
    view.hand.some((c) => c.id === view.pendingDrawnCardId && (c.value === 'wild' || c.value === 'wild4'))
    ? view.pendingDrawnCardId : null;

  const playCard = (c: Card) => {
    if (c.value === 'wild' || c.value === 'wild4') setWildCardId(c.id);
    else actions.play(c.id);
  };

  const canCall = (yourTurn && view.hand.length <= 2) || view.catchableSeat === view.yourSeat;
  const canCatch = view.catchableSeat !== null && view.catchableSeat !== view.yourSeat;

  // Thickness of the stock: one visible edge per ~7 cards, as in the prototype.
  const layers = Math.max(0, Math.min(12, Math.round(view.drawPileCount / 7)));

  return (
    <main className="table-screen">
      <div className="table-top">
        <span>{host?.name}’s table</span>
        <span className="sep" />
        <span>Round {roundsPlayed(view.winTally) + 1}</span>
        {ruleChips(view.rules).map((n) => <span key={n} className="chip">{n}</span>)}
        <a className="btn btn-ghost table-leave" href="/">Leave</a>
      </div>

      <div className="table-mid">
        <div className="felt-box">
          <div className="felt" />
          <div className="opps">
            {opponents.map((s, i) => (
              <div key={s.seat} className={`opp-slot opp-slot-${slotNames[i]}`}>
                <Seat seat={s} active={view.turnSeat === s.seat} />
              </div>
            ))}
          </div>
          <div className={`deck${canDraw ? ' deck-clickable' : ''}`}
            onClick={canDraw ? actions.draw : undefined}>
            {Array.from({ length: layers }, (_, i) => (
              <div key={i} className="deck-layer"
                style={{ bottom: i * 2.5, left: i * 1.4, background: i % 2 ? '#2a2621' : '#332f2b' }} />
            ))}
            <span className="deck-top" style={{ bottom: layers * 2.5, left: layers * 1.4 }}>
              <CardFace back size="lg" onClick={canDraw ? actions.draw : undefined} />
            </span>
            <span className="deck-count">{view.drawPileCount} left</span>
          </div>
          <div className="discard">
            <CardFace card={view.topCard} size="lg" />
          </div>
        </div>
      </div>

      <div className="hand-dock">
        <div className="banner">
          <span className="live-dot"
            style={{ background: view.currentColor ? `var(--card-${view.currentColor})` : 'var(--card-wild)' }} />
          <span className="banner-text">{rejection ?? banner}</span>
        </div>
        <div className={`hand${view.hand.length > 7 ? ' hand-tight' : ''}${yourTurn ? ' hand-turn' : ''}`}>
          {view.hand.map((c) => (
            <span key={c.id} className="hand-slot">
              <CardFace card={c}
                playable={canPlay(c)}
                raised={view.pendingDrawnCardId === c.id}
                onClick={canPlay(c) ? () => playCard(c) : undefined} />
            </span>
          ))}
        </div>
        <div className="hand-actions">
          <span className={`you-pill${yourTurn ? ' you-pill-turn' : ''}`}>
            <span className="seat-avatar" style={{ background: seatColor(view.yourSeat) }}>
              {initialOf(you?.name)}
            </span>
            <strong>{you?.name ?? 'You'}</strong>
            <span className="you-count">{view.hand.length} cards</span>
          </span>
          {view.pendingDrawnCardId !== null && !view.rules.forcePlay
            ? <button className="btn btn-secondary btn-solid" onClick={actions.pass}>Keep it</button>
            : <button className="btn btn-secondary btn-solid" disabled={!canDraw} onClick={actions.draw}>
                {yourTurn && view.pendingDraw > 0 ? `Take +${view.pendingDraw}` : 'Draw'}
              </button>}
          {canCatch
            ? <button className="btn btn-primary" onClick={actions.catchCall}>Catch</button>
            : <button className="btn btn-primary" disabled={!canCall} onClick={actions.call}>Call “last card”</button>}
        </div>
      </div>

      {view.mustChooseColor && (
        <ColorPicker title="Choose a colour" subtitle="The flip was wild — you set what plays first."
          onPick={actions.chooseColor} />
      )}
      {wildCardId !== null && (
        <ColorPicker title="Choose a colour"
          onPick={(c) => { actions.play(wildCardId, c); setWildCardId(null); }} />
      )}
      {forcedWildId !== null && wildCardId === null && (
        <ColorPicker title="Choose a colour" subtitle="Force play — your drawn wild goes down."
          onPick={(c) => actions.play(forcedWildId, c)} />
      )}
      <PauseOverlay />
    </main>
  );
}
