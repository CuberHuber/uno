// The journal, end to end over a real socket: the pointer keeping up while a
// round runs, and a return by token being handed exactly the gap.
//
// `history.test.ts` proves the journal and the store's four questions in
// isolation. This file proves the part only the wire can prove — that a socket
// dropping and a socket coming back move the pointer the way they should, and
// that nothing private rides out with the answer.
import { afterAll, beforeAll, expect, test } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { isPlayable, type CatchUpView, type RoomStateView } from '@uno/shared';
import { MAX_TRANSACTIONS } from '../src/history.js';
import { RateLimiter } from '../src/limiter.js';
import { RoomStore } from '../src/rooms.js';
import { buildServer } from '../src/server.js';

let ctx: Awaited<ReturnType<typeof buildServer>>;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  // Every client here runs from one IP, and the pointer — not the budget — is
  // what is under test; `wire.test.ts` owns the limiter's own proof.
  const wide = () => new RateLimiter(1e9, 60_000);
  ctx = await buildServer(new RoomStore(), {
    create: wide(), join: wide(), pin: wide(), action: new RateLimiter(1e9, 10_000),
  });
  await ctx.app.listen({ port: 0 }); // ephemeral: :3000 belongs to whoever runs the app
  const address = ctx.app.server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  url = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await ctx.app.close();
});

interface Watcher {
  s: Socket;
  states: RoomStateView[];
  heads: number[];
  catches: CatchUpView[];
  rejections: string[];
  /** Every frame in arrival order, so "the snapshot came first" is checkable. */
  log: string[];
}

/** A client that keeps its pointer level the way the browser does: a snapshot
 *  arrives with the head it is true as of, and applying it is what makes
 *  acknowledging that head honest. `ack: false` turns that off, so a test can
 *  watch what the *server* does to the pointer on its own. */
function client(opts: { ack?: boolean } = {}): Watcher {
  const s = connect(url, { transports: ['websocket'] });
  sockets.push(s);
  const w: Watcher = { s, states: [], heads: [], catches: [], rejections: [], log: [] };
  s.on('roomState', (v: RoomStateView) => { w.states.push(v); w.log.push('roomState'); });
  s.on('historyHead', (p: { seq: number }) => {
    w.heads.push(p.seq);
    w.log.push('historyHead');
    if (opts.ack !== false) s.emit('ackHistory', { seq: p.seq });
  });
  s.on('catchUp', (p: CatchUpView) => { w.catches.push(p); w.log.push('catchUp'); });
  s.on('moveRejected', (p: { reason: string }) => { w.rejections.push(p.reason); });
  return w;
}

type Ack = { ok: boolean; error?: string; seat?: number; token?: string };
const joinAck = (s: Socket, payload: object) =>
  new Promise<Ack>((resolve) => s.emit('joinRoom', payload, resolve));

async function waitFor(pred: () => boolean, what: string, ms = 5_000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
const settle = () => new Promise((r) => setTimeout(r, 120));

const headOf = (code: string): number => {
  const h = ctx.store.historyHead(code);
  return h.ok ? h.seq : -1;
};
const cursorOf = (code: string, seat: number): number => {
  const c = ctx.store.historyCursor(code, seat);
  return c.ok ? c.seq : -1;
};
const connectedOf = (code: string, seat: number): boolean =>
  ctx.store.getRoom(code)!.players[seat]!.connected;

/** One accepted act by whoever holds the turn, straight through the store: a
 *  deterministic supply of real transactions for the stretch when the player
 *  under test is not connected to receive them. Under classic rules neither a
 *  draw nor a pass can be refused, and neither can empty a hand, so the number
 *  of transactions a loop of these writes is exact. */
function step(code: string): void {
  const room = ctx.store.getRoom(code)!;
  const g = room.game!;
  const seat = g.turn;
  const token = room.players[seat]!.token;
  const r = g.pendingDrawn?.seat === seat
    ? ctx.store.act(code, token, { type: 'pass' })
    : ctx.store.act(code, token, { type: 'draw' });
  if (!r.ok) throw new Error(r.error);
}

/** The same act sent over the wire, so the broadcast — and the head that rides
 *  with it — actually happen. */
async function wireStep(code: string, socks: Socket[]): Promise<void> {
  const before = headOf(code);
  const g = ctx.store.getRoom(code)!.game!;
  const seat = g.turn;
  const s = socks[seat]!;
  if (g.pendingDrawn?.seat === seat) s.emit('passTurn');
  else s.emit('drawCard');
  await waitFor(() => headOf(code) > before, 'the act to be accepted');
}

/** Runs the round out to a winner through the store, the way `integration.test`
 *  drives one over the wire: play the first card that fits, otherwise draw. A
 *  seat that is offline still takes its turns — the engine does not know about
 *  sockets — which is what makes a round end while somebody is away. */
function playToWin(code: string, guard = 5_000): void {
  for (let i = 0; i < guard; i++) {
    const room = ctx.store.getRoom(code)!;
    if (room.phase !== 'playing') return;
    const g = room.game!;
    const seat = g.turn;
    const token = room.players[seat]!.token;
    const hand = g.players[seat]!.hand;
    if (g.pendingDrawn?.seat === seat) {
      const r = ctx.store.act(code, token, { type: 'pass' });
      if (!r.ok) throw new Error(r.error);
      continue;
    }
    const top = g.discard.at(-1)!;
    const playable = hand.find((c) => isPlayable(c, top, g.currentColor));
    const wild = playable?.value === 'wild' || playable?.value === 'wild4';
    const r = playable
      ? ctx.store.act(code, token, {
        type: 'play', cardIds: [playable.id], ...(wild ? { chosenColor: 'red' as const } : {}),
      })
      : ctx.store.act(code, token, { type: 'draw' });
    if (!r.ok) throw new Error(r.error);
  }
  throw new Error('the round never ended');
}

/** `"id":5` is a prefix of `"id":52`, so a plain substring search would accuse
 *  the projection of a leak it did not commit. */
const holdsCardId = (json: string, id: number) => new RegExp(`"id":${id}\\b`).test(json);

async function seatTwo(seed: number, ack = true) {
  const room = ctx.store.createRoom({ seed });
  const a = client({ ack });
  const b = client({ ack });
  const ackA = await joinAck(a.s, { code: room.code, name: 'Mira' });
  const ackB = await joinAck(b.s, { code: room.code, name: 'Jonas' });
  expect([ackA.ok, ackB.ok]).toEqual([true, true]);
  a.s.emit('startGame');
  await waitFor(() => ctx.store.getRoom(room.code)!.phase === 'playing', 'the deal');
  return { code: room.code, a, b, tokenA: ackA.token! };
}

test('the pointer keeps up while the round runs, with nobody reconnecting', async () => {
  const { code, a, b } = await seatTwo(101);
  await waitFor(() => cursorOf(code, 0) === headOf(code), 'the deal to be acknowledged');
  for (let i = 0; i < 3; i++) await wireStep(code, [a.s, b.s]);
  await waitFor(() => cursorOf(code, 0) === headOf(code), 'the acts to be acknowledged');

  // The deal plus three acts, and both pointers stand on it. This is the whole
  // point of acknowledging a snapshot: without it both pointers would still
  // read zero here, and every later return would fall off the back of the
  // journal instead of being handed its gap.
  expect(headOf(code)).toBe(4);
  expect(cursorOf(code, 0)).toBe(4);
  await waitFor(() => cursorOf(code, 1) === 4, 'the other seat too');
});

test('a return by token is handed exactly the gap, and no card that is not its own', async () => {
  const { code, a, tokenA } = await seatTwo(202);
  await waitFor(() => cursorOf(code, 0) === headOf(code), 'the deal to be acknowledged');
  const atDrop = cursorOf(code, 0);
  expect(atDrop).toBe(1);

  // A real drop: the socket goes away and only the token still names the seat.
  a.s.disconnect();
  await waitFor(() => !connectedOf(code, 0), 'the seat to go dark');

  // The table plays on. Which seat holds the turn is the engine's business, so
  // this window holds draws by both of them — the leak check below needs it to,
  // or it would only be proving that an empty window carries no cards.
  for (let i = 0; i < 4; i++) step(code);
  const head = headOf(code);
  expect(head).toBe(atDrop + 4);

  const back = client();
  const returned = await joinAck(back.s, { code, token: tokenA });
  expect(returned).toMatchObject({ ok: true, seat: 0 });
  await waitFor(() => back.catches.length > 0, 'the catch-up');

  const missed = back.catches[0]!;
  expect(missed.truncated).toBe(false);
  expect(missed.crossedRebuild).toBe(false);
  expect(missed.seq).toBe(head);
  expect(missed.you).toBe(ctx.store.getRoom(code)!.players[0]!.id);
  // Exactly the gap: nothing from before it, nothing after it, no hole in it.
  expect(missed.entries.map((e) => e.seq)).toEqual([atDrop + 1, atDrop + 2, atDrop + 3, atDrop + 4]);

  // The snapshot came too, and it came first: the catch-up supplements the
  // state, it never stands in for it.
  expect(back.states.length).toBeGreaterThan(0);
  expect(back.log.indexOf('roomState')).toBeLessThan(back.log.indexOf('catchUp'));

  // Nothing in the answer is a card still sitting in the other player's hand.
  const json = JSON.stringify(missed.entries);
  const theirs = ctx.store.getRoom(code)!.game!.players[1]!.hand;
  expect(theirs.length).toBeGreaterThan(0);
  for (const c of theirs) expect(holdsCardId(json, c.id)).toBe(false);
  // What is yours does reach you: the draws in the window arrived as cards.
  const mine = missed.entries.flatMap((e) => e.yourCards ?? []);
  expect(mine.length).toBeGreaterThan(0);
  const ours = new Set(ctx.store.getRoom(code)!.game!.players[0]!.hand.map((c) => c.id));
  for (const c of mine) expect(ours.has(c.id)).toBe(true);
});

test('a return with nothing missed is told nothing at all', async () => {
  const { code, a, tokenA } = await seatTwo(303);
  await waitFor(() => cursorOf(code, 0) === headOf(code), 'the deal to be acknowledged');
  a.s.disconnect();
  await waitFor(() => !connectedOf(code, 0), 'the seat to go dark');

  const back = client();
  expect(await joinAck(back.s, { code, token: tokenA })).toMatchObject({ ok: true, seat: 0 });
  await waitFor(() => back.states.length > 0, 'the snapshot');
  await settle();
  expect(back.catches).toEqual([]); // an empty account is worse than none
});

test('a player further behind than the journal reaches gets the snapshot and a pointer at the head', async () => {
  const { code, a, tokenA } = await seatTwo(42);
  await waitFor(() => cursorOf(code, 0) === headOf(code), 'the deal to be acknowledged');
  a.s.disconnect();
  await waitFor(() => !connectedOf(code, 0), 'the seat to go dark');

  for (let i = 0; i < MAX_TRANSACTIONS + 20; i++) step(code);
  const head = headOf(code);
  expect(ctx.store.getRoom(code)!.history.size).toBe(MAX_TRANSACTIONS);
  expect(cursorOf(code, 0)).toBeLessThan(head - MAX_TRANSACTIONS);

  // This one never acknowledges anything, so the only thing that can move its
  // pointer is the server owning up to the gap.
  const back = client({ ack: false });
  expect(await joinAck(back.s, { code, token: tokenA })).toMatchObject({ ok: true, seat: 0 });
  await waitFor(() => back.catches.length > 0, 'the catch-up');

  const missed = back.catches[0]!;
  expect(missed.truncated).toBe(true);
  expect(missed.entries).toEqual([]); // a list with a hole would read as "nothing else happened"
  expect(missed.seq).toBe(head);
  expect(back.states.length).toBeGreaterThan(0); // the snapshot arrived regardless

  // The honest consequence: the pointer sits on the head, and the next gap is
  // answerable again.
  expect(cursorOf(code, 0)).toBe(head);
  expect(ctx.store.historySince(code, 0, head)).toMatchObject({ ok: true, entries: [] });
}, 30_000);

test('a hostile number in an acknowledgement moves nothing and takes nothing down', async () => {
  const { code, a, b } = await seatTwo(404, false);
  await waitFor(() => headOf(code) === 1, 'the deal');
  a.s.emit('ackHistory', { seq: 1 });
  await waitFor(() => cursorOf(code, 0) === 1, 'one honest acknowledgement');

  // The class the seat guard already turns away, now on the number. `NaN` and
  // `Infinity` reach the server as `null` — JSON has no word for them — and are
  // refused all the same.
  const hostile: unknown[] = ['__proto__', 'length', 'constructor', '1', '', 1.5, -1,
    NaN, Infinity, 2 ** 53, null, true, {}, []];
  for (const seq of hostile) a.s.emit('ackHistory', { seq });
  a.s.emit('ackHistory', undefined);
  a.s.emit('ackHistory');
  await waitFor(() => a.rejections.length >= hostile.length + 2, 'every hostile frame refused');
  expect([...new Set(a.rejections)]).toEqual(['bad_request']);

  expect(cursorOf(code, 0)).toBe(1);
  expect(Object.prototype.hasOwnProperty.call(Array.prototype, 'historyCursor')).toBe(false);
  expect(([] as unknown as { historyCursor?: number }).historyCursor).toBeUndefined();
  expect(cursorOf(code, 1)).toBe(0); // nobody else's pointer moved either

  // The instance is still serving: the table plays on, and the pointer still
  // moves for a number that is one.
  await wireStep(code, [a.s, b.s]);
  a.s.emit('ackHistory', { seq: 2 });
  await waitFor(() => cursorOf(code, 0) === 2, 'the pointer after the storm');
});

test('a rematch inside the gap is declared, not glued over', async () => {
  const room = ctx.store.createRoom({ seed: 7 });
  const a = client(); const b = client(); const c = client();
  const ackA = await joinAck(a.s, { code: room.code, name: 'Mira' });
  const ackB = await joinAck(b.s, { code: room.code, name: 'Jonas' });
  expect((await joinAck(c.s, { code: room.code, name: 'Ada' })).ok).toBe(true);
  expect([ackA.ok, ackB.ok]).toEqual([true, true]);
  a.s.emit('startGame');
  await waitFor(() => ctx.store.getRoom(room.code)!.phase === 'playing', 'the deal');
  await waitFor(() => cursorOf(room.code, 1) === headOf(room.code), 'the deal to be acknowledged');
  const atDrop = cursorOf(room.code, 1);

  b.s.disconnect();
  await waitFor(() => !connectedOf(room.code, 1), 'the seat to go dark');

  playToWin(room.code);
  expect(ctx.store.getRoom(room.code)!.phase).toBe('roundEnd');
  a.s.emit('rematch');
  await waitFor(() => ctx.store.getRoom(room.code)!.phase === 'playing', 'the second deal');

  const back = client();
  expect(await joinAck(back.s, { code: room.code, token: ackB.token })).toMatchObject({ ok: true, seat: 1 });
  await waitFor(() => back.catches.length > 0, 'the catch-up');

  const missed = back.catches[0]!;
  // The boundary is in the window and it is announced. Without the flag a
  // client would read a seat number from before the compaction as the same
  // person who sits there now.
  expect(missed.crossedRebuild).toBe(true);
  expect(missed.entries.some((e) => e.kind === 'seatsRebuilt')).toBe(true);
  expect(missed.entries.map((e) => e.seq)).toEqual(
    Array.from({ length: missed.seq - atDrop }, (_, i) => atDrop + 1 + i),
  );
  // Names for the ids the transactions carry, so the account never has to read
  // identity out of a seat number that changed meaning halfway through.
  expect(missed.seats.map((s) => s.name)).toEqual(['Mira', 'Jonas', 'Ada']);
  expect(missed.you).toBe(ctx.store.getRoom(room.code)!.players[1]!.id);

  // The fresh deal is inside the gap, so this is also the strongest leak check
  // there is: two whole hands were dealt to other people in this window.
  //
  // Only the half after the boundary, though. Each deal builds its own deck and
  // numbers it from zero, so an id from the round before names a different card
  // — matching today's hands against it would accuse the projection of numbers
  // that belong to a deck already thrown away.
  const rebuiltAt = missed.entries.find((e) => e.kind === 'seatsRebuilt')!.seq;
  const json = JSON.stringify(missed.entries.filter((e) => e.seq > rebuiltAt));
  const g = ctx.store.getRoom(room.code)!.game!;
  for (const seat of [0, 2]) {
    for (const card of g.players[seat]!.hand) expect(holdsCardId(json, card.id)).toBe(false);
  }
  // Your own new hand is in there, and it is the whole of what is private in
  // the answer: the second deal reached you the moment you came back.
  const ours = new Set(g.players[1]!.hand.map((card) => card.id));
  const secondDeal = missed.entries.filter((e) => e.kind === 'roundStarted').at(-1)!;
  expect(secondDeal.yourCards).not.toBeNull();
  for (const card of secondDeal.yourCards!) expect(ours.has(card.id)).toBe(true);
}, 30_000);

test('a repeated or stale acknowledgement never rolls the pointer back', async () => {
  const { code, a, b } = await seatTwo(505, false);
  for (let i = 0; i < 3; i++) await wireStep(code, [a.s, b.s]);
  const head = headOf(code);
  expect(head).toBe(4);

  a.s.emit('ackHistory', { seq: head });
  await waitFor(() => cursorOf(code, 0) === head, 'the pointer to reach the head');

  // A socket replaced mid-round can still have an old frame in flight. Each of
  // these is accepted, and none of them changes anything.
  for (const stale of [0, 1, 2, head - 1, head]) a.s.emit('ackHistory', { seq: stale });
  await settle();
  expect(cursorOf(code, 0)).toBe(head);
  expect(a.rejections).toEqual([]);

  // A number from the future is another matter: it claims to have applied
  // something that does not exist yet, and is refused outright.
  a.s.emit('ackHistory', { seq: head + 1 });
  await waitFor(() => a.rejections.length > 0, 'the refusal');
  expect(a.rejections).toEqual(['cursor_ahead']);
  expect(cursorOf(code, 0)).toBe(head);
});
