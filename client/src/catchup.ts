// The room's journal, read back as sentences: what happened while one player
// was away. Pure — it takes the catch-up the server sent plus the two
// translators and returns lines. It reaches no socket and no state.
//
// Identity here is always the `playerId`, never the seat number. A rematch
// renumbers the seats, so the same number before and after that boundary names
// two different people; the id is the part that keeps its meaning, and
// `view.seats` is what puts a name to it.
import type { CatchUpView, Color, Effect, MoveKind, PlayerId, SeatTransaction } from '@uno/shared';
import type { MsgKey, PluralKey } from './i18n';

type Tr = (key: MsgKey, vars?: Record<string, string | number>) => string;
type Tn = (key: PluralKey, n: number) => string;

export interface CatchUpRow {
  key: string;
  text: string;
  /** It happened to you: your own act, or cards that landed in your hand. */
  mine: boolean;
  /** The rematch boundary. Before it the seat numbers meant other people. */
  boundary: boolean;
}

/** Which pair of wordings an act takes; the second is the one that says "you".
 *  Russian conjugates, so a single "{name} does X" cannot cover both — the same
 *  split the dictionary already makes between `t.sitsOut` and `t.youSitOut`. */
const MOVE_KEYS: Record<MoveKind, readonly [MsgKey, MsgKey]> = {
  play: ['catchup.play', 'catchup.playYou'],
  draw: ['catchup.draw', 'catchup.drawYou'],
  pass: ['catchup.pass', 'catchup.passYou'],
  chooseColor: ['catchup.color', 'catchup.colorYou'],
  callLastCard: ['catchup.call', 'catchup.callYou'],
  catchLastCard: ['catchup.catch', 'catchup.catchYou'],
};

const COLOR_KEYS: Record<Color, MsgKey> = {
  red: 'color.red', yellow: 'color.yellow', green: 'color.green', blue: 'color.blue',
};

/** How many cards one kind of effect moved for one seat. The seat is read from
 *  the same transaction the effects came in, so it is that transaction's own
 *  seating and a boundary crossed later cannot pair them up wrongly. Both kinds
 *  are asked for by name because a forced play emits `drew` and `played` for
 *  the same seat, and only one of the two answers the question. */
const countOf = (effects: Effect[], seat: number, want: 'played' | 'drew'): number | null => {
  for (const e of effects) {
    if (e.seat !== seat) continue;
    if (want === 'played' && e.type === 'played') return e.cards.length;
    if (want === 'drew' && e.type === 'drew') return e.count;
  }
  return null;
};

export function catchUpRows(view: CatchUpView, t: Tr, tn: Tn): CatchUpRow[] {
  const nameOf = (playerId: PlayerId | null): string => {
    if (playerId === null) return t('catchup.someone');
    if (playerId === view.you) return t('t.you');
    return view.seats.find((s) => s.playerId === playerId)?.name ?? t('catchup.someone');
  };
  return view.entries.map((tx) => rowOf(tx, view.you, t, tn, nameOf));
}

function rowOf(
  tx: SeatTransaction, you: PlayerId, t: Tr, tn: Tn, nameOf: (id: PlayerId | null) => string,
): CatchUpRow {
  const key = String(tx.seq);
  const byYou = tx.actor.kind === 'player' && tx.actor.playerId === you;
  // The only private thing a transaction carries, and it is yours by
  // construction: the server projected this copy onto your seat, nobody else's.
  const gained = tx.yourCards?.length ?? 0;

  switch (tx.kind) {
    case 'roundStarted':
      return {
        key, boundary: false, mine: gained > 0,
        text: gained > 0
          ? t('catchup.dealYou', { cards: tn('catchup.cards', gained) })
          : t('catchup.deal'),
      };
    case 'move': {
      const seat = tx.actor.kind === 'player' ? tx.actor.seat : -1;
      const actor = tx.actor.kind === 'player' ? tx.actor.playerId : null;
      // Both lookups take a value that arrived over the wire, so both are read
      // as "or nothing". A key that is not in the table would hand `t` an
      // undefined key, and a render that throws is a blank screen.
      const [theirs, yours] = MOVE_KEYS[tx.payload.move] ?? MOVE_KEYS.play;
      const moved = tx.payload.move === 'draw'
        ? countOf(tx.effects, seat, 'drew')
        : countOf(tx.effects, seat, 'played');
      const colorKey = tx.payload.currentColor === null
        ? null
        : COLOR_KEYS[tx.payload.currentColor] ?? null;
      const text = t(byYou ? yours : theirs, {
        name: nameOf(actor),
        cards: tn('catchup.cards', moved ?? 1),
        color: colorKey === null ? '' : t(colorKey),
      });
      // Cards reach a hand without its owner doing anything: a +2 answered, a
      // missed call caught. Saying so is the difference between a readable list
      // and a hand count in the snapshot that looks as if it came from nowhere.
      const note = gained > 0 && !byYou
        ? ` · ${t('catchup.gained', { cards: tn('catchup.cards', gained) })}`
        : '';
      return { key, boundary: false, mine: byYou || gained > 0, text: text + note };
    }
    case 'roundEnded': {
      const won = tx.payload.winnerPlayerId;
      return {
        key, boundary: false, mine: won === you,
        text: won === you ? t('catchup.wonYou') : t('catchup.won', { name: nameOf(won) }),
      };
    }
    case 'playerRemoved':
      // The name comes out of the transaction and not the roster: whoever this
      // was may be gone from the table by the time the list is read.
      return { key, boundary: false, mine: false, text: t('catchup.left', { name: tx.payload.name }) };
    case 'rulesChanged':
      return { key, boundary: false, mine: false, text: t('catchup.rules') };
    case 'seatsRebuilt':
      return { key, boundary: true, mine: false, text: t('catchup.rebuilt') };
  }
}
