import { describe, expect, test } from 'vitest';
import { CLASSIC_RULES } from '@uno/shared';
import { MAX_TRANSACTIONS, RoomHistory, type TxActor } from '../src/history.js';
import { CONTINUE_GRACE_MS, RoomStore } from '../src/rooms.js';
import { card } from './game-play.test.js';

const SYSTEM: TxActor = { kind: 'system' };
const playerAt = (playerId: string, seat: number): TxActor => ({ kind: 'player', playerId, seat });

const moveBody = (move: 'play' | 'draw' | 'pass' = 'draw') => ({
  move, handCounts: [7, 7], turnSeat: 0, currentColor: 'red' as const, topCard: null,
});

/** Values that must never reach an array index or a comparison: the class of
 *  defect `isSeatIndex` exists for. */
const HOSTILE: unknown[] = [
  '__proto__', 'length', 'constructor', '1', -1, 1.5, 2, 99, NaN, Infinity, null, undefined,
];

function table(names: string[], seed = 42) {
  let clock = 1_000_000;
  const store = new RoomStore(() => clock);
  const room = store.createRoom({ seed });
  const tokens = names.map((n) => {
    const j = store.join(room.code, n);
    if (!j.ok) throw new Error(j.error);
    return j.token;
  });
  const started = store.startGame(room.code, tokens[0]!);
  if (!started.ok) throw new Error(started.error);
  return { store, room, tokens, tick: (ms: number) => { clock += ms; } };
}

/** One accepted act by whoever holds the turn: draw, or pass if the last draw
 *  left a playable card in hand. Neither can be refused under classic rules, so
 *  a loop of these is a deterministic supply of real transactions. */
function step(store: RoomStore, code: string): number {
  const room = store.getRoom(code)!;
  const g = room.game!;
  const seat = g.turn;
  const token = room.players[seat]!.token;
  const r = g.pendingDrawn?.seat === seat
    ? store.act(code, token, { type: 'pass' })
    : store.act(code, token, { type: 'draw' });
  if (!r.ok) throw new Error(r.error);
  return seat;
}

/** `"id":5` is a prefix of `"id":52`, so a plain substring search would accuse
 *  the projection of a leak it did not commit. */
const holdsCardId = (json: string, id: number) => new RegExp(`"id":${id}\\b`).test(json);

describe('the journal itself', () => {
  test('numbers rise, never restart, and trimming leaves the sequence unbroken', () => {
    const h = new RoomHistory(() => 1_000, 5);
    expect(h.seq).toBe(0);
    expect(h.firstSeq).toBe(1); // nothing kept, so nothing is missing either
    for (let i = 0; i < 12; i++) h.record('move', SYSTEM, moveBody(), 'playing');
    expect(h.seq).toBe(12);
    expect(h.size).toBe(5);
    expect(h.firstSeq).toBe(8);
    const got = h.since(7, 'nobody');
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.entries.map((e) => e.seq)).toEqual([8, 9, 10, 11, 12]); // no reused numbers
    expect(got.seq).toBe(12);
  });

  test('a pointer older than the journal is reported, not silently short-changed', () => {
    const h = new RoomHistory(() => 1_000, 5);
    for (let i = 0; i < 12; i++) h.record('move', SYSTEM, moveBody(), 'playing');
    expect(h.since(3, 'x')).toEqual({ ok: false, error: 'history_truncated', seq: 12, firstSeq: 8 });
    expect(h.since(6, 'x').ok).toBe(false); // needs 7, the journal starts at 8
    expect(h.since(7, 'x').ok).toBe(true);  // exactly at the edge still catches up
  });

  test('a number from the future is refused', () => {
    const h = new RoomHistory(() => 1_000);
    h.record('move', SYSTEM, moveBody(), 'playing');
    expect(h.since(2, 'x')).toEqual({ ok: false, error: 'cursor_ahead', seq: 1, firstSeq: 1 });
    expect(h.since(1, 'x').ok).toBe(true);
  });

  test('hostile pointer values are answers, not exceptions', () => {
    const h = new RoomHistory(() => 1_000);
    h.record('move', SYSTEM, moveBody(), 'playing');
    for (const bad of HOSTILE.filter((v) => v !== 2 && v !== 99)) {
      expect(h.since(bad as number, 'x')).toMatchObject({ ok: false, error: 'bad_cursor' });
    }
    expect(Object.prototype.hasOwnProperty.call(Array.prototype, 'seq')).toBe(false);
    expect(h.since(0, 'x').ok).toBe(true); // the journal still works afterwards
  });

  test('an empty journal answers with nothing missing', () => {
    const h = new RoomHistory(() => 1_000);
    const got = h.since(0, 'x');
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.entries).toEqual([]);
    expect(got.crossedRebuild).toBe(false);
  });

  test('a secret reaches its owner and nobody else', () => {
    const h = new RoomHistory(() => 1_000);
    const drawn = card('blue', '9');
    h.record(
      'move', playerAt('p1', 1),
      { move: 'draw', handCounts: [3, 4], turnSeat: 0, currentColor: 'red', topCard: null },
      'playing',
      { effects: [{ type: 'drew', seat: 1, count: 1 }], secrets: [{ playerId: 'p1', cards: [drawn] }] },
    );

    const theirs = h.since(0, 'p0');
    expect(theirs.ok).toBe(true);
    if (!theirs.ok) return;
    // The same shape of proof as views.test.ts: no card object survives the
    // projection onto a seat that owns none of them.
    expect(JSON.stringify(theirs.entries)).not.toContain('"value"');
    expect(JSON.stringify(theirs.entries)).not.toContain('secrets');
    expect(theirs.entries[0]!.yourCards).toBeNull();
    expect(theirs.entries[0]!.effects).toEqual([{ type: 'drew', seat: 1, count: 1 }]); // the count is public

    const mine = h.since(0, 'p1');
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;
    expect(mine.entries[0]!.yourCards).toEqual([drawn]);
  });

  test('a reseating is a loud boundary in the window that spans it', () => {
    const h = new RoomHistory(() => 1_000);
    h.record('move', playerAt('p2', 2), moveBody(), 'playing');
    expect(h.seatEpoch).toBe(0);
    h.reseat(
      playerAt('p2', 1),
      [{ seat: 0, playerId: 'p1', name: 'Jonas' }, { seat: 1, playerId: 'p2', name: 'Ada' }],
      'roundEnd',
    );
    expect(h.seatEpoch).toBe(1);
    const spanning = h.since(0, 'p2');
    expect(spanning.ok && spanning.crossedRebuild).toBe(true);
    const after = h.since(2, 'p2');
    expect(after.ok && after.crossedRebuild).toBe(false); // nothing stale left in the window
    expect(h.seq).toBe(2); // the boundary did not restart the numbering
  });
});

describe('the room writes down what it accepted', () => {
  test('a deal is recorded; a refused act is not', () => {
    const { store, room, tokens } = table(['Mira', 'Jonas']);
    expect(store.historyHead(room.code)).toEqual({ ok: true, seq: 1, firstSeq: 1, seatEpoch: 0 });

    const turn = store.getRoom(room.code)!.game!.turn;
    const idle = turn === 0 ? 1 : 0;
    expect(store.act(room.code, tokens[idle]!, { type: 'play', cardIds: [9999] }).ok).toBe(false);
    expect(store.setRules(room.code, tokens[0]!, CLASSIC_RULES).ok).toBe(false); // locked
    expect(store.setPin(room.code, tokens[0]!, '1234').ok).toBe(false);
    expect(store.historyHead(room.code)).toMatchObject({ seq: 1 }); // rejections are telemetry

    step(store, room.code);
    expect(store.historyHead(room.code)).toMatchObject({ seq: 2 });
  });

  test('a house-rule change is recorded with the host as its actor', () => {
    const store = new RoomStore(() => 1_000_000);
    const room = store.createRoom();
    const host = store.join(room.code, 'Mira');
    const guest = store.join(room.code, 'Jonas');
    if (!host.ok || !guest.ok) throw new Error('setup');
    expect(store.setRules(room.code, guest.token, { ...CLASSIC_RULES, stacking: true }).ok).toBe(false);
    expect(store.historyHead(room.code)).toMatchObject({ seq: 0 });
    expect(store.setRules(room.code, host.token, { ...CLASSIC_RULES, stacking: true }).ok).toBe(true);

    const got = store.historySince(room.code, 1, 0);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    const [tx] = got.entries;
    expect(tx!.kind).toBe('rulesChanged');
    expect(tx!.actor).toEqual({ kind: 'player', playerId: store.getRoom(room.code)!.players[0]!.id, seat: 0 });
    expect(tx!.phase).toBe('lobby');
    expect(tx!.payload).toEqual({ rules: { ...CLASSIC_RULES, stacking: true } });
  });

  test('a new arrival starts level with the head, not at the beginning', () => {
    const store = new RoomStore(() => 1_000_000);
    const room = store.createRoom();
    const host = store.join(room.code, 'Mira');
    store.join(room.code, 'Jonas');
    if (!host.ok) throw new Error('setup');
    store.setRules(room.code, host.token, { ...CLASSIC_RULES, stacking: true });
    const late = store.join(room.code, 'Ada');
    if (!late.ok) throw new Error('setup');
    expect(store.historyCursor(room.code, late.seat)).toEqual({ ok: true, seq: 1 });
    expect(store.historyCursor(room.code, 0)).toEqual({ ok: true, seq: 0 });
  });

  test('removing a player and ending the round are two recorded facts', () => {
    const { store, room, tokens, tick } = table(['Mira', 'Jonas']);
    const head = store.historyHead(room.code);
    store.setConnection(room.code, 1, null);
    tick(CONTINUE_GRACE_MS + 1);
    expect(store.continueWithout(room.code, tokens[0]!, 1).ok).toBe(true);

    const got = store.historySince(room.code, 0, head.ok ? head.seq : 0);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.entries.map((e) => e.kind)).toEqual(['playerRemoved', 'roundEnded']);
    const [removed, ended] = got.entries;
    expect(removed!.payload).toMatchObject({ seat: 1, name: 'Jonas' });
    expect(removed!.phase).toBe('roundEnd');
    expect(ended!.actor).toEqual({ kind: 'system' }); // the room drew the consequence
    expect(ended!.payload).toMatchObject({ winnerSeat: 0, winTally: [1, 0] });
  });
});

describe('no second channel for other people’s cards', () => {
  test('a drawn card reaches only the player who drew it', () => {
    const { store, room } = table(['Mira', 'Jonas']);
    const head = store.historyHead(room.code);
    const at = head.ok ? head.seq : 0;
    const seat = step(store, room.code);
    const other = seat === 0 ? 1 : 0;

    const mine = store.historySince(room.code, seat, at);
    const theirs = store.historySince(room.code, other, at);
    expect(mine.ok && theirs.ok).toBe(true);
    if (!mine.ok || !theirs.ok) return;
    const drawn = mine.entries[0]!.yourCards;
    expect(drawn).toHaveLength(1);
    expect(theirs.entries[0]!.yourCards).toBeNull();
    expect(theirs.entries[0]!.effects).toEqual([{ type: 'drew', seat, count: 1 }]);
    expect(holdsCardId(JSON.stringify(theirs.entries), drawn![0]!.id)).toBe(false);
  });

  test('a full catch-up never carries a card still in someone else’s hand', () => {
    const { store, room } = table(['Mira', 'Jonas', 'Ada']);
    for (let i = 0; i < 12; i++) step(store, room.code);

    for (const viewer of [0, 1, 2]) {
      const got = store.historySince(room.code, viewer, 0); // everything, from the deal on
      expect(got.ok).toBe(true);
      if (!got.ok) return;
      const json = JSON.stringify(got.entries);
      const hands = store.getRoom(room.code)!.game!.players;
      for (const [seat, p] of hands.entries()) {
        for (const c of p.hand) {
          // Cards still in a hand were never public. Yours may appear; nobody else's may.
          expect(holdsCardId(json, c.id)).toBe(seat === viewer);
        }
      }
    }
  });

  test('the PIN and the tokens are nowhere in the journal, in any form', () => {
    const store = new RoomStore(() => 1_000_000);
    const room = store.createRoom({ pin: '1234', seed: 7 });
    const host = store.join(room.code, 'Mira', '1234');
    const guest = store.join(room.code, 'Jonas', '1234');
    if (!host.ok || !guest.ok) throw new Error('setup');
    expect(store.setPin(room.code, host.token, '4321').ok).toBe(true);
    expect(store.setRules(room.code, host.token, { ...CLASSIC_RULES, stacking: true }).ok).toBe(true);
    expect(store.startGame(room.code, host.token).ok).toBe(true);
    for (let i = 0; i < 8; i++) step(store, room.code);

    // Everything the journal holds, secrets included — not the projection.
    const dump = JSON.stringify(store.getRoom(room.code)!.history);
    expect(dump).toContain('"secrets"');        // the check is not vacuous:
    expect(dump).toContain('"roundStarted"');   // the hands really are in there
    expect(dump).not.toContain('"1234"');
    expect(dump).not.toContain('"4321"');
    expect(dump).not.toMatch(/pin/i);
    for (const token of [host.token, guest.token]) expect(dump).not.toContain(token);

    const got = store.historySince(room.code, 0, 0);
    const projected = JSON.stringify(got.ok ? got.entries : []);
    expect(projected).not.toContain('"1234"');
    expect(projected).not.toContain('"4321"');
    expect(projected).not.toContain(host.token);
    expect(projected).not.toContain('secrets');
  });
});

describe('the pointer survives the rematch compaction', () => {
  test('it keeps pointing at the same person after the seats are rebuilt', () => {
    const { store, room, tokens, tick } = table(['Mira', 'Jonas', 'Ada']);
    for (let i = 0; i < 4; i++) step(store, room.code);
    const adaId = store.getRoom(room.code)!.players[2]!.id;
    const before = store.historyHead(room.code);
    if (!before.ok) return;
    expect(store.ackHistory(room.code, 2, before.seq).ok).toBe(true);

    // Mira drops out of the round, then the deal passes to Jonas.
    store.setConnection(room.code, 0, null);
    tick(CONTINUE_GRACE_MS + 1);
    expect(store.continueWithout(room.code, tokens[1]!, 0).ok).toBe(true);
    store.getRoom(room.code)!.phase = 'roundEnd';
    expect(store.rematch(room.code, tokens[1]!).ok).toBe(true);

    const after = store.getRoom(room.code)!;
    expect(after.players.map((p) => p.name)).toEqual(['Jonas', 'Ada']); // Ada moved 2 → 1
    expect(after.players[1]!.id).toBe(adaId);
    // The pointer rode along on Ada's record, not on the number 2.
    expect(store.historyCursor(room.code, 1)).toEqual({ ok: true, seq: before.seq });

    const head = store.historyHead(room.code);
    expect(head.ok && head.seq).toBeGreaterThan(before.seq); // numbering never restarted
    expect(head.ok && head.seatEpoch).toBe(1);

    const got = store.historySince(room.code, 1, before.seq);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.crossedRebuild).toBe(true); // seat numbers before the boundary are stale
    const boundary = got.entries.find((e) => e.kind === 'seatsRebuilt');
    expect(boundary).toBeDefined();
    expect(boundary!.payload).toEqual({
      seats: [
        { seat: 0, playerId: after.players[0]!.id, name: 'Jonas' },
        { seat: 1, playerId: adaId, name: 'Ada' },
      ],
    });
    // Ada is dealt a new hand and it is hers alone.
    const dealt = got.entries.find((e) => e.kind === 'roundStarted');
    expect(dealt!.yourCards).toHaveLength(7);
    const jonas = store.historySince(room.code, 0, before.seq);
    if (!jonas.ok) return;
    const jonasJson = JSON.stringify(jonas.entries);
    for (const c of dealt!.yourCards!) expect(holdsCardId(jonasJson, c.id)).toBe(false);
  });

  test('a transaction written before the compaction still names its actor', () => {
    const { store, room, tokens, tick } = table(['Mira', 'Jonas', 'Ada']);
    const actors = new Map<string, string>(
      store.getRoom(room.code)!.players.map((p) => [p.id, p.name]),
    );
    for (let i = 0; i < 6; i++) step(store, room.code);
    store.setConnection(room.code, 0, null);
    tick(CONTINUE_GRACE_MS + 1);
    store.continueWithout(room.code, tokens[1]!, 0);
    store.getRoom(room.code)!.phase = 'roundEnd';
    expect(store.rematch(room.code, tokens[1]!).ok).toBe(true);

    const got = store.historySince(room.code, 1, 0);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    for (const e of got.entries) {
      if (e.actor.kind !== 'player') continue;
      // The seat number is only good within its own epoch; the id always resolves.
      expect(actors.get(e.actor.playerId)).toBeDefined();
    }
    const epochs = new Set(got.entries.map((e) => e.seatEpoch));
    expect(epochs).toEqual(new Set([0, 1])); // both seatings are visible and told apart
  });
});

describe('the four questions the socket layer will ask are total', () => {
  test('a missing room is an answer', () => {
    const store = new RoomStore();
    expect(store.historyHead('AAAAA')).toEqual({ ok: false, error: 'table_not_found' });
    expect(store.historyCursor('AAAAA', 0)).toEqual({ ok: false, error: 'table_not_found' });
    expect(store.historySince('AAAAA', 0, 0)).toEqual({ ok: false, error: 'table_not_found' });
    expect(store.ackHistory('AAAAA', 0, 0)).toEqual({ ok: false, error: 'table_not_found' });
  });

  test('hostile seat values are refused and nothing is written through a prototype', () => {
    const { store, room } = table(['Mira', 'Jonas']);
    for (const seat of HOSTILE) {
      expect(store.historyCursor(room.code, seat as number)).toEqual({ ok: false, error: 'no_such_seat' });
      expect(store.historySince(room.code, seat as number, 0)).toMatchObject({ ok: false, error: 'no_such_seat' });
      expect(store.ackHistory(room.code, seat as number, 0)).toEqual({ ok: false, error: 'no_such_seat' });
    }
    expect(Object.prototype.hasOwnProperty.call(Array.prototype, 'historyCursor')).toBe(false);
    expect(([] as unknown as { historyCursor?: number }).historyCursor).toBeUndefined();
    expect(store.historyCursor(room.code, 0).ok).toBe(true); // the real index still works
  });

  test('hostile pointer values reach neither the journal nor the player record', () => {
    const { store, room } = table(['Mira', 'Jonas']);
    for (const bad of HOSTILE.filter((v) => v !== 2 && v !== 99)) {
      expect(store.historySince(room.code, 0, bad as number)).toMatchObject({ ok: false, error: 'bad_cursor' });
      expect(store.ackHistory(room.code, 0, bad as number)).toEqual({ ok: false, error: 'bad_cursor' });
    }
    expect(store.historyCursor(room.code, 0)).toEqual({ ok: true, seq: 0 });
  });

  test('the pointer moves forward only, and never past the head', () => {
    const { store, room } = table(['Mira', 'Jonas']);
    for (let i = 0; i < 3; i++) step(store, room.code);
    expect(store.ackHistory(room.code, 0, 3)).toEqual({ ok: true, seq: 3 });
    expect(store.ackHistory(room.code, 0, 1)).toEqual({ ok: true, seq: 3 }); // a late ack cannot re-open a gap
    expect(store.ackHistory(room.code, 0, 99)).toEqual({ ok: false, error: 'cursor_ahead' });
    expect(store.historyCursor(room.code, 0)).toEqual({ ok: true, seq: 3 });
    const owed = store.historySince(room.code, 0, 3);
    expect(owed.ok && owed.entries.map((e) => e.seq)).toEqual([4]); // the deal plus three acts
    expect(store.ackHistory(room.code, 0, 4)).toEqual({ ok: true, seq: 4 });
    const caught = store.historySince(room.code, 0, 4);
    expect(caught.ok && caught.entries).toEqual([]); // caught up: nothing owed
  });

  test('a room trims to its cap and says so when a pointer falls off the back', () => {
    const { store, room } = table(['Mira', 'Jonas']);
    for (let i = 0; i < MAX_TRANSACTIONS + 20; i++) step(store, room.code);

    const head = store.historyHead(room.code);
    expect(head.ok).toBe(true);
    if (!head.ok) return;
    expect(store.getRoom(room.code)!.history.size).toBe(MAX_TRANSACTIONS);
    expect(head.seq).toBe(MAX_TRANSACTIONS + 21); // the deal plus every act
    expect(head.firstSeq).toBe(head.seq - MAX_TRANSACTIONS + 1);

    expect(store.historySince(room.code, 0, 0)).toEqual({
      ok: false, error: 'history_truncated', seq: head.seq, firstSeq: head.firstSeq,
    });
    const edge = store.historySince(room.code, 0, head.firstSeq - 1);
    expect(edge.ok).toBe(true);
    if (!edge.ok) return;
    expect(edge.entries).toHaveLength(MAX_TRANSACTIONS);
    expect(edge.entries.map((e) => e.seq)).toEqual(
      Array.from({ length: MAX_TRANSACTIONS }, (_, i) => head.firstSeq + i), // no hole
    );
    // The caller's way out: send a snapshot, then bring the pointer to the head.
    expect(store.ackHistory(room.code, 0, head.seq)).toEqual({ ok: true, seq: head.seq });
    expect(store.historySince(room.code, 0, head.seq).ok).toBe(true);
  });
});
