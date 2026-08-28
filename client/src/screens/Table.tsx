// The live table — game-process port of
// design/Ochre Eights - Full Game Flexible.dc.html onto the real protocol.
// The server stays authoritative; effects and view diffs drive the choreography.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isNumberCard, type Card, type Color, type Effect, type RoomStateView } from '@uno/shared';
import { track } from '../analytics';
import HelpSheet from '../components/HelpSheet';
import PauseOverlay from '../components/PauseOverlay';
import SoundSettings from '../components/SoundSettings';
import { cue } from '../sound';
import RulesSlide, { hasSeenSlide, markSlideSeen } from './RulesSlide';
import { useT, type MsgKey } from '../i18n';
import { useStore } from '../store';
import { initialOf, roundsPlayed, ruleChips, seatColor } from '../ui';
import { CardFront, faceOf, PileBack, SUIT, type Face } from '../table/cards';
import { seatSlots, stageLayout } from '../table/layout';

const FLY_MS = 620;
const DRAW_MS = 460;

interface FlyClone { id: number; card: Card; from: string; delay: number; heavy: boolean }
interface OppAnim { key: number; kind: 'fly' | 'draw'; slot: number; card: Card | null }

/** Absolute card that mounts at `from` and glides to `to`. */
function Flight({ from, to, ms, delay = 0, z, ease, anim, onDone, children }: {
  from: string; to: string; ms: number; delay?: number; z: number; ease: string;
  anim?: string; onDone?: () => void; children: ReactNode;
}) {
  const [go, setGo] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setGo(true)));
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    if (!go || !onDone) return;
    const t = setTimeout(onDone, ms + delay);
    return () => clearTimeout(t);
  }, [go]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0, width: 104, height: 156, zIndex: z,
      transform: go ? to : from, transition: `transform ${ms}ms ${ease} ${delay}ms`,
    }}>
      <div style={{ width: '100%', height: '100%', animation: anim ?? 'none' }}>{children}</div>
    </div>
  );
}

export default function Table() {
  const { view, actions, rejection, effect } = useStore();
  const { t, tn, terr, locale } = useT();

  // Viewport → stage geometry (fixed design space, scaled).
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onR = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);
  const L = stageLayout(vp.w, vp.h);

  const viewRef = useRef<RoomStateView | null>(view);
  viewRef.current = view;

  // Presentation state.
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [wildIds, setWildIds] = useState<number[] | null>(null);
  const [leaving, setLeaving] = useState<FlyClone[]>([]);
  const [freshIds, setFreshIds] = useState<Set<number>>(new Set());
  const [dispTop, setDispTop] = useState<Card | null>(view?.topCard ?? null);
  const [oppQueue, setOppQueue] = useState<OppAnim[]>([]);
  const [toast, setToast] = useState('');
  // The rules sheet. Nothing but the "?" ever opens it — no first run, no prompt.
  const [helpOpen, setHelpOpen] = useState(false);
  // The pre-round slide, once per browser per room. It cannot hold the deal back: the
  // server deals the moment the host asks and knows nothing about a slide. So it lies
  // over a table that is already live and steps aside by itself when the turn reaches
  // this seat — a slow reader never loses a turn, and nobody waits for one.
  const [slideOpen, setSlideOpen] = useState(false);
  const slideAsked = useRef(false);
  const [big, setBig] = useState<{ text: string } | null>(null);
  const [shakeId, setShakeId] = useState<number | null>(null);
  const [shuffling, setShuffling] = useState(false);
  const [quaking, setQuaking] = useState(false);
  const [scatter, setScatter] = useState(false);
  const [reFly, setReFly] = useState<{ key: number } | null>(null);
  const [penaltyFly, setPenaltyFly] = useState<{ key: number; slot: number; n: number } | null>(null);
  const [tint, setTint] = useState<{ color: Color; offs: { dx: number; dy: number }[]; leaving: boolean } | null>(null);

  const leavingIds = useMemo(() => new Set(leaving.map((l) => l.id)), [leaving]);
  const leavingRef = useRef(leavingIds);
  leavingRef.current = leavingIds;
  const animKey = useRef(1);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTry = useRef<number[]>([]);
  const penaltyAt = useRef(0);

  // Haptics where the platform has them; silently nothing elsewhere.
  const buzz = (pattern: number | number[]) => {
    try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
  };
  const quake = () => {
    setQuaking(true);
    setTimeout(() => setQuaking(false), 700);
  };

  const showToast = (msg: string, ms = 2000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(''), ms);
  };

  // Opponent seats → anchor slots.
  const yourSeat = view?.yourSeat ?? 0;
  const opponents = useMemo(
    () => (view?.seats ?? []).filter((s) => s.seat !== yourSeat),
    [view?.seats, yourSeat],
  );
  const slots = seatSlots(opponents.length);
  const slotOfSeat = (seat: number): number => {
    const k = opponents.findIndex((s) => s.seat === seat);
    return k === -1 ? 1 : (slots[k] ?? 1);
  };

  // ── Effects → choreography ────────────────────────────────────────────────
  const processed = useRef<Effect | null>(effect);
  useEffect(() => {
    if (!effect || effect === processed.current) return;
    processed.current = effect;
    const v = viewRef.current;
    if (!v) return;
    const nameOf = (seat: number) => (seat === v.yourSeat ? t('t.you') : v.seats.find((s) => s.seat === seat)?.name ?? 'Player');
    const stepFrom = (from: number): number => {
      const order = [...v.seats].map((s) => s.seat).sort((a, b) => a - b);
      const i = order.indexOf(from);
      return order[(((i + v.direction) % order.length) + order.length) % order.length]!;
    };
    const enqueue = (a: Omit<OppAnim, 'key'>) => setOppQueue((q) => [...q, { ...a, key: animKey.current++ }]);

    if (effect.type === 'played') {
      const last = effect.cards.at(-1)!;
      // One voice per kind of card. A number is the everyday sound and must never
      // tire; an action is sharper; a wild announces itself. The +4 keeps quiet here
      // and slams below, on the beat where the card actually lands.
      if (last.value !== 'wild4') {
        cue(last.value === 'wild' ? 'wild' : isNumberCard(last) ? 'play' : 'action');
      }
      if (effect.seat !== v.yourSeat) {
        for (const c of effect.cards.slice(0, 3)) enqueue({ kind: 'fly', slot: slotOfSeat(effect.seat), card: c });
      } else if (!effect.cards.some((c) => leavingRef.current.has(c.id))) {
        enqueue({ kind: 'fly', slot: -1, card: last }); // force-played straight from the pile
      }
      if (last.value === 'reverse') showToast(t('t.reversed'));
      if (last.value === 'skip') {
        const tgt = stepFrom(effect.seat);
        showToast(tgt === v.yourSeat ? t('t.youSitOut') : t('t.sitsOut', { name: nameOf(tgt) }));
      }
      if (last.value === 'wild4') {
        // the +4 slam, timed to the card's landing: table quake + shadow scatter
        setTimeout(() => {
          quake(); buzz([70, 40, 90]); cue('slam');
          setScatter(true);
          setTimeout(() => setScatter(false), 2200);
        }, 550);
      }
      if (last.value === 'draw2' || last.value === 'wild4') {
        penaltyAt.current = Date.now(); // the matching 'drew' pops the big counter
        if (v.rules.stacking) {
          const total = v.pendingDraw + (last.value === 'draw2' ? 2 : 4);
          const tgt = stepFrom(effect.seat);
          const who = tgt === v.yourSeat ? t('t.youLower') : nameOf(tgt);
          showToast(t('t.pot', { n: total, name: who }) + (v.pendingDraw > 0 ? t('t.stacked') : ''), 2200);
        }
      }
    } else if (effect.type === 'drew') {
      // A pot being taken (stacking) or a +2/+4 landing (classic): big counter,
      // and from +8 the whole table quakes — straight from the prototype.
      const pot = v.pendingDraw > 0 && effect.count === v.pendingDraw;
      const penalty = effect.count >= 2 && Date.now() - penaltyAt.current < 800;
      if (pot || penalty) {
        const heavy = effect.count >= 8;
        setBig({ text: `+${effect.count}` });
        if (heavy) quake();
        buzz(heavy ? [80, 50, 120] : 80); cue('penalty');
        setTimeout(() => setBig(null), 900);
      } else {
        cue('draw');
      }
      if (effect.seat !== v.yourSeat) {
        const slot = slotOfSeat(effect.seat);
        if (pot || penalty) {
          // penalty backs rain sideways onto the victim's seat (board's ob-flyseat)
          const key = animKey.current++;
          setPenaltyFly({ key, slot, n: Math.min(effect.count, 4) });
          setTimeout(() => setPenaltyFly((p) => (p?.key === key ? null : p)), 1550);
        } else {
          for (let i = 0; i < Math.min(effect.count, 5); i++) enqueue({ kind: 'draw', slot, card: null });
        }
        if (effect.count > 1) showToast(t('t.draws', { name: nameOf(effect.seat), n: effect.count }));
      }
    } else if (effect.type === 'called') {
      showToast(t('t.called', { name: nameOf(effect.seat) }));
      cue('uno');
    } else if (effect.type === 'caught') {
      showToast(t('t.caught', { name: nameOf(effect.seat) }));
      buzz(100); cue('caught');
    }
    // 'win' is deliberately absent: the same packet that carries it flips the phase
    // to roundEnd, and React batches the two, so this component can be gone before
    // the effect runs. The cue is fired from the store, where nothing unmounts.
  }, [effect]); // eslint-disable-line react-hooks/exhaustive-deps

  // The deal, heard by everyone at the table. It used to be the host's lobby button,
  // so every guest — who never pressed it — was dealt into silence. Once per round,
  // and only while no card has moved yet, so a mid-game reconnect stays quiet.
  const dealt = useRef(false);
  useEffect(() => {
    const n = view?.hand.length ?? 0;
    if (dealt.current || !n || !view) return;
    if (view.seats.some((s) => s.cardCount !== n)) return;
    dealt.current = true;
    cue('deal');
  }, [view?.hand.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rejected move: cards snap back, culprit shakes, reason toasts.
  useEffect(() => {
    if (!rejection) return;
    if (leavingRef.current.size > 0) {
      setLeaving([]);
      setShakeId(lastTry.current[0] ?? null);
      setTimeout(() => setShakeId(null), 550);
    }
    buzz(40); cue('reject');
    showToast(terr(rejection));
  }, [rejection]); // eslint-disable-line react-hooks/exhaustive-deps

  // New hand cards enter from the pile (deal-in, draws, draw-to-match runs).
  const prevIds = useRef<Set<number>>(new Set());
  useEffect(() => {
    const cur = new Set((view?.hand ?? []).map((c) => c.id));
    const added = [...cur].filter((id) => !prevIds.current.has(id));
    prevIds.current = cur;
    if (!added.length) return;
    setFreshIds((s) => new Set([...s, ...added]));
    added.forEach((id, i) => {
      setTimeout(() => setFreshIds((s) => {
        const n = new Set(s); n.delete(id); return n;
      }), 90 + i * 150);
    });
  }, [view?.hand]);

  // Discard top lags the authoritative view while a flight is on its way.
  useEffect(() => {
    const top = view?.topCard;
    if (!top || dispTop?.id === top.id) return;
    if (leaving.length === 0 && oppQueue.length === 0) { setDispTop(top); return; }
    const t = setTimeout(() => setDispTop(viewRef.current?.topCard ?? top), FLY_MS + 500);
    return () => clearTimeout(t);
  }, [view?.topCard?.id, leaving.length, oppQueue.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // A jump up in the pile count means the discard got reshuffled under it:
  // the top flies back face-down (reFly + ob-flip), then the pile wiggles.
  const prevPile = useRef(view?.drawPileCount ?? 0);
  useEffect(() => {
    const n = view?.drawPileCount ?? 0;
    if (n > prevPile.current + 3) setReFly({ key: animKey.current++ });
    prevPile.current = n;
  }, [view?.drawPileCount]);

  // Called-colour tint splash follows the view, with the board's leave animation.
  const tintRef = useRef(tint);
  tintRef.current = tint;
  useEffect(() => {
    const v = view;
    if (!v?.topCard) return;
    const wild = v.topCard.value === 'wild' || v.topCard.value === 'wild4';
    const target = wild && v.currentColor ? v.currentColor : null;
    const mkOffs = () => [0, 1, 2, 3].map((i) => ({
      dx: (Math.random() - 0.5) * (30 + i * 45),
      dy: (Math.random() - 0.5) * (24 + i * 36),
    }));
    const cur = tintRef.current;
    if (target) {
      if (cur && cur.color === target && !cur.leaving) return;
      if (cur && !cur.leaving) {
        setTint({ ...cur, leaving: true });
        const t = setTimeout(() => setTint({ color: target, offs: mkOffs(), leaving: false }), 620);
        return () => clearTimeout(t);
      }
      setTint({ color: target, offs: mkOffs(), leaving: false });
    } else if (cur && !cur.leaving) {
      setTint({ ...cur, leaving: true });
      const t = setTimeout(() => setTint(null), 620);
      return () => clearTimeout(t);
    }
  }, [view?.topCard?.id, view?.currentColor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selection dies with the turn or a hand change.
  useEffect(() => { setPicked([]); }, [view?.turnSeat, view?.hand.length]);

  // A short pulse when the turn lands on you.
  const prevTurn = useRef<number | null>(null);
  useEffect(() => {
    const t = view?.turnSeat ?? null;
    if (t !== prevTurn.current && t === view?.yourSeat) { buzz(30); cue('turn'); }
    prevTurn.current = t;
  }, [view?.turnSeat]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ask localStorage once, as soon as the room code is known. A browser that has read
  // the slide for this room stays quiet through every rematch played in it.
  const roomCode = view?.roomCode ?? '';
  useEffect(() => {
    if (slideAsked.current || !roomCode) return;
    slideAsked.current = true;
    setSlideOpen(!hasSeenSlide(roomCode));
  }, [roomCode]);
  useEffect(() => {
    if (!slideOpen || !view || view.turnSeat !== view.yourSeat) return;
    track('slide_viewed', { closedBy: 'turn' }); // auto-closed: reader may not have finished
    markSlideSeen(roomCode);
    setSlideOpen(false);
  }, [slideOpen, roomCode, view?.turnSeat, view?.yourSeat]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!view || !view.topCard) return null;

  const yourTurn = view.turnSeat === view.yourSeat && !view.paused;
  const you = view.seats.find((s) => s.seat === view.yourSeat);
  const host = view.seats.find((s) => s.isHost);
  const hand = view.hand;
  const live = hand.filter((c) => !leavingIds.has(c.id));
  const hi = live.findIndex((c) => c.id === hoverId);
  const top = dispTop ?? view.topCard;
  const topFace = faceOf(top);
  const topIsWild = view.topCard.value === 'wild' || view.topCard.value === 'wild4';
  const calledHex = view.currentColor ? SUIT[view.currentColor]! : '#2a2621';

  const fanPos = (i: number, n: number) => {
    const spread = n > 1 ? Math.min(6.5, L.spreadTot / (n - 1)) : 0;
    const a0 = (i - (n - 1) / 2) * spread;
    const rad = (a0 * Math.PI) / 180;
    return { x: L.cx + Math.sin(rad) * L.R - 52, y: L.anchorY - Math.cos(rad) * L.R - 78, a: a0 };
  };
  const discTf = (id: number) => `translate(${L.discX}px, ${L.discY}px) rotate(${(id % 11) - 5}deg)`;

  // Playability is the round's answer, not ours: the view carries the ids. The
  // only thing left here is the local one — a card mid-flight is not clickable.
  const canPlay = (c: Card) => leaving.length === 0 && view.legal.includes(c.id);

  const firstPicked = picked.length ? hand.find((h) => h.id === picked[0]) : undefined;
  const stackAddable = (c: Card) =>
    picked.length > 0 && isNumberCard(c) && c.value === firstPicked?.value && !picked.includes(c.id);

  const playNow = (ids: number[], color?: Color) => {
    const cards = ids.map((id) => hand.find((c) => c.id === id)).filter((c): c is Card => !!c);
    if (!cards.length) return;
    const n = live.length;
    const clones = cards.map((c, k) => {
      const i = live.findIndex((h) => h.id === c.id);
      const { x, y, a } = fanPos(i === -1 ? 0 : i, n);
      return {
        id: c.id, card: c, delay: k * 130,
        from: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${a.toFixed(2)}deg)`,
        heavy: c.value === 'wild4',
      };
    });
    lastTry.current = ids;
    setLeaving((l) => [...l, ...clones]);
    setPicked([]); setHoverId(null); setWildIds(null);
    actions.play(ids, color);
  };

  const shake = (id: number) => {
    setShakeId(id);
    buzz(40); cue('reject');
    setTimeout(() => setShakeId(null), 550);
  };

  const onCardClick = (c: Card) => {
    if (!yourTurn || leaving.length > 0) return;
    if (picked.includes(c.id)) { setPicked((p) => p.filter((id) => id !== c.id)); return; }
    if (picked.length > 0 && stackAddable(c)) { setPicked((p) => [...p, c.id]); return; }
    if (!canPlay(c)) { shake(c.id); return; }
    if (c.value === 'wild' || c.value === 'wild4') { setWildIds([c.id]); return; }
    // A just-drawn card may lead a stack too: it stays the first pick, so it is
    // always part of what goes down, and its twins can be tapped on after it.
    if (view.rules.multiDiscard && isNumberCard(c)
        && (view.pendingDrawnCardId === null || view.pendingDrawnCardId === c.id)
        && hand.some((h) => h.id !== c.id && isNumberCard(h) && h.value === c.value)) {
      setPicked([c.id]); // twins in hand: start a stack; Discard 1 or tap the twin
      return;
    }
    playNow([c.id]);
  };

  const canDraw = yourTurn && view.pendingDrawnCardId === null && leaving.length === 0;
  const canPass = yourTurn && view.pendingDrawnCardId !== null && !view.rules.forcePlay && picked.length === 0;
  const canCall = !!you && !you.calledLastCard && hand.length > 0 &&
    ((yourTurn && hand.length <= 2) || view.catchableSeat === view.yourSeat);
  const canCatch = view.catchableSeat !== null && view.catchableSeat !== view.yourSeat;

  const forcedWildId = view.rules.forcePlay && view.pendingDrawnCardId !== null &&
    hand.some((c) => c.id === view.pendingDrawnCardId && (c.value === 'wild' || c.value === 'wild4'))
    ? view.pendingDrawnCardId : null;

  let playableCount = 0;
  for (const c of live) if (canPlay(c)) playableCount++;

  const turnName = view.seats.find((s) => s.seat === view.turnSeat)?.name;
  const statusText = yourTurn
    ? view.pendingDraw > 0
      ? t('st.answer', { n: view.pendingDraw })
      : view.pendingDrawnCardId !== null
        ? t('st.drawn')
        : picked.length > 0
          ? t('st.throwing', { n: picked.length })
          : t('st.turn', { n: playableCount })
    : t('st.waiting', { name: turnName ?? '…' });

  const pickerOpen = wildIds !== null || (forcedWildId !== null && wildIds === null);
  const onPickColor = (c: Color) => {
    if (wildIds) { playNow(wildIds, c); return; }
    if (forcedWildId !== null) playNow([forcedWildId], c);
  };

  const oppAnim = oppQueue[0] ?? null;
  const oppAnimSeat = oppAnim ? L.seats[oppAnim.slot === -1 ? 1 : oppAnim.slot]! : null;

  return (
    <main className="stage-wrap">
      <div className="stage" style={{
        width: L.W, height: L.H,
        transform: `translate(-50%, -50%) scale(${L.scale.toFixed(3)})`,
        ['--stage-k' as never]: L.scale.toFixed(3),
        background: 'var(--felt)',
        animation: quaking ? 'ob-quake .65s ease-in-out' : 'none',
      }}>
        {/* direction ring */}
        <div style={{
          position: 'absolute', left: L.ringL, top: L.ringT, width: 350, height: 350,
          borderRadius: '50%', border: '3px dashed rgba(42,38,33,.16)',
          animation: 'ob-spin 26s linear infinite',
          animationDirection: view.direction === 1 ? 'normal' : 'reverse',
          pointerEvents: 'none', zIndex: 1,
        }} />

        {/* called-colour tint splash (pops in, folds away on colour change) */}
        {tint && (
          [3, 2, 1, 0].map((i) => {
            const dm = [270, 480, 760, 1090][i]!;
            const off = tint.offs[i]!;
            return (
              <div key={`${tint.color}-${i}`} style={{
                position: 'absolute',
                left: Math.round(L.tintX + off.dx - dm / 2), top: Math.round(L.tintY + off.dy - dm / 2),
                width: dm, height: dm, borderRadius: '50%',
                background: SUIT[tint.color], opacity: [0.5, 0.32, 0.2, 0.12][i],
                zIndex: 1, pointerEvents: 'none',
                animation: tint.leaving
                  ? `ob-tintout .55s cubic-bezier(.5,0,.75,.6) ${(i * 0.05).toFixed(2)}s both`
                  : `ob-tint 1.05s cubic-bezier(.25,.7,.3,1) ${(i * 0.09).toFixed(2)}s both`,
              }} />
            );
          })
        )}

        {/* your-turn glow */}
        {yourTurn && (
          <div style={{
            position: 'absolute', left: L.glowL, right: L.glowR, bottom: -120, height: 340,
            borderRadius: '50%',
            background: 'radial-gradient(ellipse at center, rgba(198,113,57,.32) 0%, rgba(198,113,57,0) 68%)',
            animation: 'ob-glowspot 2.2s ease-in-out infinite', pointerEvents: 'none',
          }} />
        )}

        {/* opponent seats */}
        {opponents.map((s, k) => {
          const slot = L.seats[slots[k]!]!;
          const active = view.turnSeat === s.seat;
          const m = Math.min(s.cardCount, 9);
          return (
            <div key={s.seat} style={{
              position: 'absolute', left: slot.x, top: slot.y, width: 220,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              zIndex: 8, transform: `scale(${L.seatScale})`, transformOrigin: 'top center',
            }}>
              <div style={{ position: 'relative', width: 200, height: 78 }}>
                {Array.from({ length: m }, (_, j) => {
                  const off = j - (m - 1) / 2;
                  return (
                    <div key={j} style={{
                      position: 'absolute', left: '50%', top: 8, width: 46, height: 70, marginLeft: -23,
                      borderRadius: 8, background: '#2a2621', border: '2px solid rgba(247,237,220,.35)',
                      boxSizing: 'border-box', boxShadow: '0 4px 10px rgba(46,43,37,.25)',
                      transform: `translate(${(off * Math.min(18, 120 / m)).toFixed(1)}px, ${(Math.abs(off) * 2.4).toFixed(1)}px) rotate(${(off * 7).toFixed(1)}deg)`,
                      transition: 'transform .5s cubic-bezier(.34,1.45,.64,1)',
                    }} />
                  );
                })}
                {s.cardCount === 1 && (
                  <span style={{
                    position: 'absolute', right: -8, top: -6, fontFamily: 'var(--font-heading)',
                    fontSize: 12, color: '#f7eddc', background: '#c23b2e', borderRadius: 999,
                    padding: '4px 11px', boxShadow: 'var(--shadow-sm)', zIndex: 3,
                    animation: 'ob-pop .4s cubic-bezier(.34,1.56,.64,1) both, ob-pulse 1.6s ease-out .4s infinite',
                  }}>{t('table.uno')}</span>
                )}
              </div>
              {active && <span className="march-badge" style={{ margin: '0 0 -6px', position: 'relative', zIndex: 2 }}>{t('table.playing')}</span>}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, background: '#fdf8ef',
                borderRadius: 999, padding: '5px 16px 5px 5px', boxShadow: 'var(--shadow-md)',
                border: `2px solid ${active ? 'var(--color-accent)' : 'transparent'}`, boxSizing: 'border-box',
              }}>
                <div style={{
                  width: 38, height: 38, borderRadius: '50%', background: seatColor(s.seat),
                  color: '#fdf8ef', display: 'grid', placeItems: 'center',
                  fontFamily: 'var(--font-heading)', fontSize: 16, border: '2px solid #fdf8ef', boxSizing: 'border-box',
                }}>{initialOf(s.name)}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.15 }}>{s.name}</div>
                  <div style={{
                    fontSize: 11, fontWeight: 600,
                    color: active ? 'var(--color-accent-700)' : 'var(--color-neutral-500)',
                  }}>{!s.connected ? t('table.away') : active ? t('table.thinking') : tn('table.cards', s.cardCount)}</div>
                </div>
              </div>
            </div>
          );
        })}

        {/* draw pile */}
        <div data-pile={canDraw ? 'live' : 'idle'}
          onClick={canDraw ? () => { setPicked([]); actions.draw(); } : undefined} style={{
          position: 'absolute', left: L.pileX, top: L.pileY, width: 104, height: 156,
          cursor: canDraw ? 'pointer' : 'default', zIndex: 5, transition: 'left .5s ease, top .5s ease',
        }}>
          <div style={{ position: 'absolute', left: 6, top: 6, width: 104, height: 156, borderRadius: 15, background: '#211e1a' }} />
          <div style={{ position: 'absolute', left: 3, top: 3, width: 104, height: 156, borderRadius: 15, background: '#26221d' }} />
          <PileBack />
          <div style={{
            position: 'absolute', left: '50%', top: 166, transform: 'translateX(-50%)',
            whiteSpace: 'nowrap', fontSize: 12, fontWeight: 700,
            color: canDraw ? 'var(--color-accent-700)' : 'var(--color-neutral-500)',
            background: '#fdf8ef', borderRadius: 999, padding: '4px 12px', boxShadow: 'var(--shadow-sm)',
          }}>
            {yourTurn && view.pendingDraw > 0
              ? t('table.takeN', { n: view.pendingDraw })
              : t(view.rules.drawToMatch ? 'table.drawMatch' : 'table.draw', { n: view.drawPileCount })}
          </div>
          {shuffling && (
            <>
              <div style={{ position: 'absolute', left: 0, top: 0, width: 104, height: 156, borderRadius: 15, background: '#2a2621', border: '3px solid rgba(247,237,220,.4)', boxSizing: 'border-box', zIndex: 3, animation: 'ob-shufl .45s ease-in-out 2' }} />
              <div style={{ position: 'absolute', left: 0, top: 0, width: 104, height: 156, borderRadius: 15, background: '#26221d', border: '3px solid rgba(247,237,220,.3)', boxSizing: 'border-box', zIndex: 2, animation: 'ob-shufr .45s ease-in-out .12s 2' }} />
            </>
          )}
        </div>

        {/* pending pot + toast pills */}
        {view.pendingDraw > 0 && yourTurn && (
          <div style={{
            position: 'absolute', left: '50%', top: L.pendTop, transform: 'translateX(-50%)',
            background: '#c23b2e', color: '#f7eddc', borderRadius: 999, padding: '10px 24px',
            fontFamily: 'var(--font-heading)', fontSize: 15, letterSpacing: '.02em', zIndex: 91,
            boxShadow: 'var(--shadow-md)', whiteSpace: 'nowrap',
            animation: 'ob-pop .4s cubic-bezier(.34,1.56,.64,1) both, ob-pulse 1.6s ease-out .4s infinite',
          }}>
            {t('table.pend', { n: view.pendingDraw, card: view.pendingDrawKind === 'wild4' ? '+4' : '+2' })}
          </div>
        )}
        {toast && (
          <div style={{
            position: 'absolute', left: '50%', top: L.toastTop, transform: 'translateX(-50%)',
            background: '#2a2621', color: '#f7eddc', borderRadius: 999, padding: '9px 20px',
            fontSize: 13.5, fontWeight: 700, zIndex: 92, boxShadow: 'var(--shadow-md)',
            whiteSpace: 'nowrap', maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis',
            animation: 'ob-pop .4s cubic-bezier(.34,1.56,.64,1) both',
          }}>{toast}</div>
        )}

        {/* discard */}
        <div data-discard={`${top.color ?? 'wild'}-${top.value}`}
          style={{ position: 'absolute', left: L.discX, top: L.discY, width: 104, height: 156, zIndex: 4, transition: 'left .5s ease, top .5s ease' }}>
          <div style={{
            position: 'absolute', inset: 0, borderRadius: 15, background: 'rgba(0,0,0,.08)',
            transform: scatter ? 'translate(-17px,6px) rotate(-18deg)' : 'rotate(-7deg)',
            transition: 'transform .4s cubic-bezier(.2,.9,.3,1.2)',
          }} />
          <div style={{
            position: 'absolute', inset: 0, borderRadius: 15, background: 'rgba(0,0,0,.08)',
            transform: scatter ? 'translate(14px,-5px) rotate(15deg)' : 'rotate(5deg)',
            transition: 'transform .4s cubic-bezier(.2,.9,.3,1.2)',
          }} />
          <div style={{ position: 'absolute', inset: 0, transform: `rotate(${(top.id % 9) - 4}deg)`, boxShadow: 'var(--shadow-md)', borderRadius: 15 }}>
            <CardFront face={topFace}
              rim={(top.value === 'wild' || top.value === 'wild4') && view.currentColor ? calledHex : undefined} />
          </div>
        </div>

        {/* opponent play / draw flights */}
        {oppAnim && oppAnimSeat && (oppAnim.kind === 'fly' ? (
          <Flight key={oppAnim.key} z={30} ms={FLY_MS} ease="cubic-bezier(.34,1.4,.64,1)"
            from={oppAnim.slot === -1
              ? `translate(${L.pileX}px, ${L.pileY}px) scale(1) rotate(0deg)`
              : `translate(${oppAnimSeat.cx - 52}px, ${oppAnimSeat.cy - 50}px) scale(.45) rotate(-20deg)`}
            to={`translate(${L.discX}px, ${L.discY}px) scale(1) rotate(3deg)`}
            onDone={() => {
              if (oppAnim.card) setDispTop(oppAnim.card);
              setOppQueue((q) => q.slice(1));
            }}>
            <div style={{ width: '100%', height: '100%', boxShadow: '0 18px 34px rgba(46,43,37,.3)', borderRadius: 15 }}>
              {oppAnim.card && <CardFront face={faceOf(oppAnim.card)} />}
            </div>
          </Flight>
        ) : (
          <Flight key={oppAnim.key} z={30} ms={DRAW_MS} ease="cubic-bezier(.5,.1,.4,1)"
            from={`translate(${L.pileX}px, ${L.pileY}px) scale(1) rotate(0deg)`}
            to={`translate(${oppAnimSeat.cx - 52}px, ${oppAnimSeat.cy - 50}px) scale(.45) rotate(14deg)`}
            onDone={() => setOppQueue((q) => q.slice(1))}>
            <div style={{
              width: '100%', height: '100%', borderRadius: 15, background: '#2a2621',
              border: '3px solid rgba(247,237,220,.4)', boxSizing: 'border-box',
              boxShadow: '0 14px 28px rgba(46,43,37,.3)',
            }} />
          </Flight>
        ))}

        {/* reshuffle: the old top flies back face-down (flipping), then the pile wiggles */}
        {reFly && (
          <Flight key={reFly.key} z={75} ms={800} ease="cubic-bezier(.5,.1,.3,1)"
            from={`translate(${L.discX}px, ${L.discY}px) rotate(3deg)`}
            to={`translate(${L.pileX}px, ${L.pileY}px) rotate(0deg)`}
            anim="ob-flip .8s ease-in-out both"
            onDone={() => {
              setReFly(null);
              setShuffling(true); cue('shuffle');
              setTimeout(() => setShuffling(false), 1000);
            }}>
            <div style={{
              width: '100%', height: '100%', borderRadius: 15, background: '#2a2621',
              border: '3px solid rgba(247,237,220,.4)', boxSizing: 'border-box',
              boxShadow: '0 14px 28px rgba(46,43,37,.3)',
            }} />
          </Flight>
        )}

        {/* penalty backs raining sideways onto the victim's seat */}
        {penaltyFly && (() => {
          const seat = L.seats[penaltyFly.slot]!;
          return Array.from({ length: penaltyFly.n }, (_, i) => (
            <div key={`${penaltyFly.key}-${i}`} style={{
              position: 'absolute', left: 0, top: 0, width: 74, height: 110, borderRadius: 11,
              background: '#2a2621', border: '3px solid rgba(247,237,220,.4)', boxSizing: 'border-box',
              zIndex: 70,
              ['--fly-from' as never]: `translate(${L.pileX + 15}px, ${L.pileY + 20}px)`,
              ['--fly-to' as never]: `translate(${seat.cx - 37}px, ${seat.cy - 55}px)`,
              animation: `ob-flyseat .9s ease-in ${(i * 0.14).toFixed(2)}s both`,
            }} />
          ));
        })()}

        {/* your played cards in flight */}
        {leaving.map((fl) => (
          <Flight key={fl.id} z={60} ms={FLY_MS} delay={fl.delay} ease="cubic-bezier(.34,1.45,.64,1)"
            from={fl.from} to={discTf(fl.id)}
            anim={fl.heavy ? 'ob-heavy .66s cubic-bezier(.45,0,.55,1) both' : undefined}
            onDone={() => {
              setDispTop(fl.card);
              setLeaving((l) => l.filter((x) => x.id !== fl.id));
            }}>
            <div style={{ width: '100%', height: '100%', boxShadow: '0 18px 34px rgba(46,43,37,.3)', borderRadius: 15 }}>
              <CardFront face={faceOf(fl.card)} />
            </div>
          </Flight>
        ))}

        {/* you: badge + pill */}
        <div style={{
          position: 'absolute', left: L.youL, bottom: L.youB,
          display: 'flex', flexDirection: 'column', alignItems: 'flex-start', zIndex: 40,
        }}>
          {yourTurn && (
            <span className="march-badge" style={{ fontSize: 12, padding: '5px 14px', margin: '0 0 -6px 14px', position: 'relative', zIndex: 2 }}>
              {t('table.yourTurn')}
            </span>
          )}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 11, background: '#fdf8ef',
            borderRadius: 999, padding: '6px 18px 6px 6px', boxShadow: 'var(--shadow-md)',
            border: `2px solid ${yourTurn ? 'var(--color-accent)' : 'transparent'}`, boxSizing: 'border-box',
          }}>
            <div style={{
              width: 46, height: 46, borderRadius: '50%', display: 'grid', placeItems: 'center',
              background: yourTurn ? 'conic-gradient(var(--color-accent) 72%, var(--color-neutral-200) 0)' : 'var(--color-neutral-200)',
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: '50%', background: seatColor(view.yourSeat),
                color: '#fdf8ef', display: 'grid', placeItems: 'center',
                fontFamily: 'var(--font-heading)', fontSize: 17, border: '2px solid #fdf8ef', boxSizing: 'border-box',
              }}>{initialOf(you?.name)}</div>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.15 }}>{you?.name ?? 'You'}</div>
              <div style={{
                fontSize: 11.5, fontWeight: 600,
                color: yourTurn ? 'var(--color-accent-700)' : 'var(--color-neutral-500)',
              }}>{statusText}</div>
            </div>
          </div>
        </div>

        {/* your hand fan */}
        {live.map((c, i) => {
          const p = canPlay(c);
          const isPicked = picked.includes(c.id);
          const addable = stackAddable(c);
          const fresh = freshIds.has(c.id);
          let tf: string;
          if (fresh) {
            tf = `translate(${L.pileX}px, ${L.pileY}px) rotate(0deg)`;
          } else {
            let { x, y, a } = fanPos(i, live.length);
            let scale = '';
            if (p) y -= 9;
            if (isPicked) { y -= 52; a *= 0.3; scale = ' scale(1.06)'; }
            else if (hi >= 0) {
              const dd = i - hi;
              if (dd === 0) { y -= 52; a *= 0.3; scale = ' scale(1.06)'; }
              else { const push = [0, 26, 14, 6][Math.min(Math.abs(dd), 3)]!; x += Math.sign(dd) * push; }
            }
            tf = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${a.toFixed(2)}deg)${scale}`;
          }
          const hovered = hoverId === c.id && !fresh;
          return (
            <div key={c.id} data-card={c.id} data-playable={p ? '1' : '0'}
              onClick={() => onCardClick(c)}
              onMouseEnter={() => setHoverId(c.id)}
              onMouseLeave={() => setHoverId((h) => (h === c.id ? null : h))}
              style={{
                position: 'absolute', left: 0, top: 0, width: 104, height: 156,
                transform: tf, transition: `transform ${FLY_MS}ms cubic-bezier(.34,1.45,.64,1)`,
                zIndex: hovered || isPicked ? 50 : 10 + i,
                cursor: yourTurn ? 'pointer' : 'default',
              }}>
              <div style={{
                width: '100%', height: '100%',
                animation: shakeId === c.id
                  ? 'ob-shake .5s ease-in-out'
                  : hovered || fresh || isPicked
                    ? 'none'
                    : `ob-breathe 3.2s ease-in-out ${(i % 5) * 0.3}s infinite`,
              }}>
                <div style={{
                  width: '100%', height: '100%', boxSizing: 'border-box', borderRadius: 15,
                  background: '#fdf8ef', position: 'relative',
                  outline: p || isPicked || addable ? '3px solid var(--color-accent)' : 'none',
                  outlineOffset: 3, boxShadow: '0 8px 18px rgba(46,43,37,.2)',
                }}>
                  <div style={{ position: 'absolute', inset: 0, borderRadius: 15, overflow: 'hidden' }}>
                    <CardFront face={faceOf(c)} />
                  </div>
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: 15, background: 'rgba(247,237,220,.5)',
                    opacity: yourTurn && !p && !isPicked && !addable ? 1 : 0,
                    transition: 'opacity .3s', pointerEvents: 'none',
                  }} />
                </div>
              </div>
            </div>
          );
        })}

        {/* action buttons */}
        {picked.length > 0 ? (
          <div style={{ position: 'absolute', right: L.endR, bottom: L.endB, display: 'flex', gap: 10, zIndex: 45 }}>
            <button type="button" className="btn ghost-pill" onClick={() => { cue('press'); setPicked([]); }}>{t('table.clear')}</button>
            <button type="button" className="btn end-btn" onClick={() => playNow(picked)}>
              {t('table.discardN', { n: picked.length })}
            </button>
          </div>
        ) : canPass ? (
          <button type="button" className="btn end-btn"
            style={{ position: 'absolute', right: L.endR, bottom: L.endB, zIndex: 45 }}
            onClick={() => { cue('press'); actions.pass(); }}>
            {t('table.endTurn')}
          </button>
        ) : null}

        {(canCatch || canCall) && (
          <button type="button" className="btn uno-btn"
            style={{ position: 'absolute', left: L.unoL, bottom: L.unoB, zIndex: 45 }}
            onClick={() => { cue('press'); if (canCatch) actions.catchCall(); else actions.call(); }}>
            {canCatch ? t('table.catch') : t('table.uno')}
            {view.catchableSeat === view.yourSeat && !canCatch && (
              <span style={{
                position: 'absolute', left: 16, right: 16, bottom: 7, height: 4,
                borderRadius: 999, background: 'rgba(247,237,220,.25)', display: 'block',
              }}>
                <span style={{
                  display: 'block', height: '100%', borderRadius: 999, background: '#c23b2e',
                  animation: 'ob-drain 2s linear forwards',
                }} />
              </span>
            )}
          </button>
        )}

        {/* colour picker popover */}
        {pickerOpen && (
          <div style={{
            position: 'absolute', left: '50%', top: L.pickTop, transform: 'translateX(-50%)',
            background: '#fdf8ef', borderRadius: 22, padding: '16px 22px', boxShadow: 'var(--shadow-lg)',
            zIndex: 90, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
            animation: 'ob-pop .45s cubic-bezier(.34,1.56,.64,1) both',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {forcedWildId !== null && wildIds === null
                ? t('table.forcedWild')
                : t('table.chooseColour')}
            </span>
            <div style={{ display: 'flex', gap: 12 }}>
              {(['red', 'blue', 'yellow', 'green'] as Color[]).map((c) => (
                <button key={c} type="button" aria-label={c}
                  onClick={() => { cue('press'); onPickColor(c); }} style={{
                  width: 46, height: 46, borderRadius: '50%', background: SUIT[c],
                  border: '3px solid #fdf8ef', boxShadow: '0 0 0 2px rgba(0,0,0,.14)',
                  cursor: 'pointer', transition: 'transform .15s',
                }} />
              ))}
            </div>
          </div>
        )}

        {/* called-colour chip */}
        {topIsWild && view.currentColor && (
          <div style={{
            position: 'absolute', left: L.chipX, top: L.chipY, display: 'flex', gap: 7,
            alignItems: 'center', background: '#fdf8ef', borderRadius: 999, padding: '5px 13px',
            boxShadow: 'var(--shadow-sm)', zIndex: 6, animation: 'ob-pop .4s cubic-bezier(.34,1.56,.64,1) both',
          }}>
            <span style={{ width: 11, height: 11, borderRadius: '50%', background: calledHex }} />
            <span style={{ fontSize: 12, fontWeight: 700 }}>
              {t('table.called', { color: t(`color.${view.currentColor}` as MsgKey) })}
            </span>
          </div>
        )}

        {/* big +N counter */}
        {big && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 85, pointerEvents: 'none' }}>
            <span style={{
              fontFamily: 'var(--font-heading)', fontSize: L.bigFs, lineHeight: 1, color: '#fdf8ef',
              background: 'var(--color-accent)', padding: '18px 58px 30px', borderRadius: 44,
              boxShadow: '0 24px 60px rgba(46,43,37,.4)',
              animation: 'ob-bigpop .55s cubic-bezier(.34,1.56,.64,1) both',
            }}>{big.text}</span>
          </div>
        )}

        {/* table info + leave */}
        <div style={{
          position: 'absolute', left: 16, top: L.ngT, display: 'flex', gap: 8, alignItems: 'center',
          flexWrap: 'wrap', zIndex: 45, maxWidth: '60%',
        }}>
          <span className="stage-chip">
            {t('table.tableOf', { name: host?.name ?? '', n: roundsPlayed(view.winTally) + 1 })}
          </span>
          {ruleChips(view.rules, locale).map((n) => <span key={n} className="stage-chip stage-chip-dim">{n}</span>)}
          {/* Help sits right after the chips that name the house rules: the chip is the
              title, this is the rest of the sentence. Off to the side of the felt, and
              it opens nothing until it is asked to. */}
          <button type="button" className="btn btn-ghost ghost-pill"
            aria-label={t('rules.helpOpen')} title={t('rules.helpOpen')}
            onClick={() => { cue('press'); track('help_open'); setHelpOpen(true); }}>?</button>
          {/* The switch belongs on the felt too: until now the only way to reach it was
              to leave the game and go back to the landing. */}
          <SoundSettings />
        </div>
        <a className="btn btn-ghost ghost-pill" href="/"
          style={{ position: 'absolute', right: L.ngR, top: L.ngT, zIndex: 45 }}>
          {t('table.leave')}
        </a>
      </div>
      {/* Outside .stage on purpose: the stage is transform-scaled, which would trap
          the sheet's position:fixed scrim inside it. */}
      <HelpSheet open={helpOpen} rules={view.rules} onClose={() => setHelpOpen(false)} />
      {/* Everyone reads it, the host included: they picked the house rules on the create
          screen, but nobody has yet been shown how the base game runs. */}
      {slideOpen && (
        <RulesSlide rules={view.rules}
          onDismiss={() => {
            track('slide_viewed', { closedBy: 'button' });
            markSlideSeen(roomCode);
            setSlideOpen(false);
          }} />
      )}
      <PauseOverlay />
    </main>
  );
}
