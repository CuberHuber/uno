// Telemetry that must not lie and must not bite.
//
// `analytics.test.ts` owns the series that were already there. This file owns
// the ones added to make the turn queue and the journal observable, and the two
// properties the whole layer stands on: nothing that names a player or a table
// reaches a label or an event, and no failure of a measurement reaches a move.
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { Registry } from 'prom-client';
import { io as connect, type Socket } from 'socket.io-client';
import { isPlayable, type CatchUpView, type RoomStateView } from '@uno/shared';
import { Analytics } from '../src/analytics.js';
import { RateLimiter } from '../src/limiter.js';
import { CONTINUE_GRACE_MS, RoomStore, turnQueueAnomaly } from '../src/rooms.js';
import { buildServer } from '../src/server.js';

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One number out of a scrape. Absent reads as zero, which is what an untouched
 *  counter means anyway. */
async function series(reg: Registry, name: string, labels = ''): Promise<number> {
  const text = await reg.metrics();
  const line = labels ? `${name}{${labels}}` : name;
  const m = text.match(new RegExp(`^${esc(line)} (-?\\d+(?:\\.\\d+)?)$`, 'm'));
  return m ? Number(m[1]) : 0;
}

/** Every label the registry is carrying, as label/value pairs. `le` is left
 *  out: bucket boundaries are Prometheus's own vocabulary, not ours. */
async function labelsOf(reg: Registry): Promise<{ label: string; value: string }[]> {
  const out: { label: string; value: string }[] = [];
  for (const metric of await reg.getMetricsAsJSON()) {
    const values = (metric as { values?: { labels?: Record<string, unknown> }[] }).values ?? [];
    for (const v of values) {
      for (const [label, value] of Object.entries(v.labels ?? {})) {
        if (label !== 'le') out.push({ label, value: String(value) });
      }
    }
  }
  return out;
}

/** A store with a table already seated, on a clock the test drives. */
function table(seats: number, seed: number) {
  const clock = { ms: 0 };
  const store = new RoomStore(() => clock.ms);
  const room = store.createRoom({ seed });
  const tokens = ['Mira', 'Jonas', 'Ada', 'Bo'].slice(0, seats).map((name) => {
    const joined = store.join(room.code, name);
    if (!joined.ok) throw new Error(joined.error);
    return joined.token;
  });
  return { store, code: room.code, tokens, clock };
}

/** One accepted act by whoever holds the turn: a deterministic supply of real
 *  transactions. Under classic rules neither a draw nor a pass can be refused. */
function step(store: RoomStore, code: string): void {
  const room = store.getRoom(code)!;
  const g = room.game!;
  const token = room.players[g.turn]!.token;
  const r = g.pendingDrawn?.seat === g.turn
    ? store.act(code, token, { type: 'pass' })
    : store.act(code, token, { type: 'draw' });
  if (!r.ok) throw new Error(r.error);
}

/** Play the first card that fits, otherwise draw, until somebody wins. */
function playToWin(store: RoomStore, code: string, guard = 5_000): void {
  for (let i = 0; i < guard; i++) {
    const room = store.getRoom(code)!;
    if (room.phase !== 'playing') return;
    const g = room.game!;
    const seat = g.turn;
    const token = room.players[seat]!.token;
    if (g.pendingDrawn?.seat === seat) {
      const passed = store.act(code, token, { type: 'pass' });
      if (!passed.ok) throw new Error(passed.error);
      continue;
    }
    const top = g.discard.at(-1)!;
    const playable = g.players[seat]!.hand.find((c) => isPlayable(c, top, g.currentColor));
    const wild = playable?.value === 'wild' || playable?.value === 'wild4';
    const r = playable
      ? store.act(code, token, {
        type: 'play', cardIds: [playable.id], ...(wild ? { chosenColor: 'red' as const } : {}),
      })
      : store.act(code, token, { type: 'draw' });
    if (!r.ok) throw new Error(r.error);
  }
  throw new Error('the round never ended');
}

// ── the series, on their own ─────────────────────────────────────────────────

test('every catch-up outcome is counted apart, and the gap is measured in transactions', async () => {
  const reg = new Registry();
  const a = new Analytics({ now: () => 0, register: reg });
  a.catchUpServed('delta', 4);
  a.catchUpServed('delta', 12);
  a.catchUpServed('empty', 0);
  a.catchUpServed('truncated', 260);
  a.catchUpServed('failed', null); // no gap to speak of: counted, never measured

  const count = (outcome: string) => series(reg, 'ochre_catchups_served_total', `outcome="${outcome}"`);
  expect(await count('delta')).toBe(2);
  expect(await count('empty')).toBe(1);
  expect(await count('truncated')).toBe(1);
  expect(await count('failed')).toBe(1);

  expect(await series(reg, 'ochre_catchup_gap_transactions_count')).toBe(4);
  expect(await series(reg, 'ochre_catchup_gap_transactions_sum')).toBe(276);
  // The whole point of the buckets: the share above the journal's cap is how
  // often 200 is what turned a return into a reset.
  expect(await series(reg, 'ochre_catchup_gap_transactions_bucket', 'le="200"')).toBe(3);
  expect(await series(reg, 'ochre_catchup_gap_transactions_bucket', 'le="400"')).toBe(4);
});

test('the wire’s refusals are counted apart from the rules’, and a stray code opens no series', async () => {
  const reg = new Registry();
  const a = new Analytics({ now: () => 0, register: reg });
  a.wireRejected('bad_request');
  a.wireRejected('bad_request');
  a.wireRejected('no_such_seat');
  a.wireRejected('Mira’s table'); // not a wire code: must not become a label
  a.moveRejected('not_your_turn');
  a.actionBudgetExceeded();
  a.actionBudgetExceeded();

  const text = await reg.metrics();
  expect(text).toMatch(/ochre_wire_frames_rejected_total\{reason="bad_request"\} 2/);
  expect(text).toMatch(/ochre_wire_frames_rejected_total\{reason="no_such_seat"\} 1/);
  expect(text).toMatch(/ochre_wire_frames_rejected_total\{reason="other"\} 1/);
  expect(text).not.toContain('Mira');
  // The two questions stay apart: a misclick is not a malformed frame, and the
  // action budget is neither.
  expect(text).toMatch(/ochre_moves_rejected_total\{reason="not_your_turn"\} 1/);
  expect(text).not.toMatch(/ochre_moves_rejected_total\{reason="bad_request"\}/);
  expect(text).not.toMatch(/ochre_moves_rejected_total\{reason="rate_limited"\}/);
  expect(text).toMatch(/ochre_action_budget_exceeded_total 2/);
});

test('a sender that throws on every event never escapes into a caller', () => {
  const a = new Analytics({
    now: () => 0,
    sendEvent: (() => { throw new Error('umami exploded'); }) as never,
  });
  expect(() => {
    a.catchUpServed('delta', 3);
    a.catchUpServed('truncated', 900);
    a.turnAnomaly('turn_on_removed', 'AAAAA');
    a.wireRejected('bad_request');
    a.actionBudgetExceeded();
    a.sessionStarted('s1');
    a.sessionEnded('s1', { code: 'AAAAA', seat: 0 });
  }).not.toThrow();
});

// ── the turn queue, from outside the engine ──────────────────────────────────

test('the turn-queue canary names each breach on a corrupted state and stays quiet on a healthy one', () => {
  const { store, code, tokens } = table(3, 21);
  expect(store.startGame(code, tokens[0]!).ok).toBe(true);
  const room = store.getRoom(code)!;
  const healthy = structuredClone(room.game!);
  expect(turnQueueAnomaly(room)).toBeNull();

  room.game!.turn = 99; // a seat this table does not have
  expect(turnQueueAnomaly(room)).toBe('turn_out_of_range');
  room.game!.turn = -1;
  expect(turnQueueAnomaly(room)).toBe('turn_out_of_range');
  room.game!.turn = 1.5; // an index that is not one
  expect(turnQueueAnomaly(room)).toBe('turn_out_of_range');

  room.game = structuredClone(healthy);
  room.game.players[room.game.turn]!.removed = true;
  expect(turnQueueAnomaly(room)).toBe('turn_on_removed');

  room.game = structuredClone(healthy);
  for (const p of room.game.players) p.removed = true;
  // Named first: with nobody in the round the other two follow from this one.
  expect(turnQueueAnomaly(room)).toBe('no_seats_left');

  // Between rounds the turn means nothing, and a finished round leaves the
  // cursor where the winning card left it. Neither is an accident.
  room.game = structuredClone(healthy);
  room.game.turn = 99;
  room.phase = 'roundEnd';
  expect(turnQueueAnomaly(room)).toBeNull();
  room.phase = 'playing';
  room.game.winner = 0;
  expect(turnQueueAnomaly(room)).toBeNull();
});

test('an accepted action on a corrupted state reaches the watcher', () => {
  const { store, code, tokens } = table(2, 8);
  const seen: [string, string][] = [];
  store.watchTurnQueue((kind, at) => seen.push([kind, at]));
  expect(store.startGame(code, tokens[0]!).ok).toBe(true);
  expect(seen).toEqual([]);

  // Calling last card inside an open window is the one accepted act that never
  // reads the turn — so a broken turn survives it, and the check outside the
  // engine is what notices.
  store.getRoom(code)!.game!.catchWindow = { seat: 1 };
  store.getRoom(code)!.game!.turn = 99;
  expect(store.act(code, tokens[1]!, { type: 'callLastCard' }).ok).toBe(true);
  expect(seen).toEqual([['turn_out_of_range', code]]);

  seen.length = 0;
  store.getRoom(code)!.game!.catchWindow = { seat: 1 };
  store.getRoom(code)!.game!.turn = 0;
  store.getRoom(code)!.game!.players[0]!.removed = true;
  expect(store.act(code, tokens[1]!, { type: 'callLastCard' }).ok).toBe(true);
  expect(seen).toEqual([['turn_on_removed', code]]);
});

test('a watcher that throws costs a reading, never a move', () => {
  const { store, code, tokens } = table(2, 9);
  store.watchTurnQueue(() => { throw new Error('the dashboard is on fire'); });
  expect(store.startGame(code, tokens[0]!).ok).toBe(true);
  store.getRoom(code)!.game!.catchWindow = { seat: 1 };
  store.getRoom(code)!.game!.turn = 99;
  expect(() => store.act(code, tokens[1]!, { type: 'callLastCard' })).not.toThrow();
  expect(store.getRoom(code)!.history.seq).toBe(2); // the deal and the call
});

test('a played round, a removal and a rematch never trip the watcher', () => {
  const { store, code, tokens, clock } = table(3, 33);
  const seen: string[] = [];
  store.watchTurnQueue((kind) => seen.push(kind));
  expect(store.startGame(code, tokens[0]!).ok).toBe(true);

  // One player walks out and is dropped once the grace has run.
  store.setConnection(code, 1, 'sock-b');
  store.setConnection(code, 1, null);
  clock.ms += CONTINUE_GRACE_MS + 1;
  expect(store.continueWithout(code, tokens[0]!, 1).ok).toBe(true);

  playToWin(store, code);
  expect(store.getRoom(code)!.phase).toBe('roundEnd');
  expect(store.rematch(code, tokens[0]!).ok).toBe(true); // the compaction
  playToWin(store, code);
  expect(seen).toEqual([]);
});

// ── the journal, as the gauges read it ───────────────────────────────────────

test('journal depth is counted and pointer lag is read off the connected seats only', () => {
  const { store, code, tokens } = table(2, 12);
  const quiet = store.createRoom({ seed: 13 });
  expect(store.journalStats()).toEqual({ stored: 0, deepest: 0, lagMax: 0 });

  expect(store.startGame(code, tokens[0]!).ok).toBe(true);
  store.setConnection(code, 0, 'sock-a');
  store.setConnection(code, 1, 'sock-b');
  // The deal is written and nobody has acknowledged it: one transaction stored,
  // and both live pointers are one behind.
  expect(store.journalStats()).toEqual({ stored: 1, deepest: 1, lagMax: 1 });

  store.ackHistory(code, 0, 1);
  store.ackHistory(code, 1, 1);
  expect(store.journalStats().lagMax).toBe(0);

  // A player who is away is *supposed* to fall behind — counting them would
  // drown the only thing this gauge is for.
  store.setConnection(code, 1, null);
  for (let i = 0; i < 3; i++) step(store, code);
  store.ackHistory(code, 0, store.getRoom(code)!.history.seq);
  expect(store.journalStats()).toEqual({ stored: 4, deepest: 4, lagMax: 0 });
  expect(store.getRoom(quiet.code)!.history.size).toBe(0); // the empty room adds nothing

  // And when the acknowledgements stop, the gauge is what says so.
  for (let i = 0; i < 5; i++) step(store, code);
  expect(store.journalStats().lagMax).toBe(5);
});

// ── over the wire ────────────────────────────────────────────────────────────

let ctx: Awaited<ReturnType<typeof buildServer>>;
let url: string;
let reg: Registry;
const lines: Record<string, unknown>[] = [];
const sent: [string, Record<string, unknown> | undefined][] = [];
const clock = { ms: 1_000 };
const sockets: Socket[] = [];

beforeAll(async () => {
  reg = new Registry();
  const log = {
    info: (o: object) => lines.push(o as Record<string, unknown>),
    error: (o: object) => lines.push(o as Record<string, unknown>),
    debug: () => {}, warn: () => {}, fatal: () => {}, trace: () => {},
  } as unknown as FastifyBaseLogger;
  const analytics = new Analytics({
    log,
    register: reg,
    // Writes down what it was asked to send, then blows up in the caller's
    // face — synchronously, which is the harshest shape a broken sender has.
    sendEvent: ((name: string, data?: Record<string, unknown>) => {
      sent.push([name, data]);
      throw new Error('umami exploded');
    }) as never,
  });
  // Every client here runs from one IP and the budgets are not what is under
  // test; `wire.test.ts` owns the limiter's own proof.
  const wide = () => new RateLimiter(1e9, 60_000);
  ctx = await buildServer(new RoomStore(() => clock.ms), {
    create: wide(), join: wide(), pin: wide(), action: new RateLimiter(1e9, 10_000),
  }, { analytics });
  await ctx.app.listen({ port: 0 }); // ephemeral: :3000 belongs to whoever runs the app
  const address = ctx.app.server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  url = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await ctx.app.close();
});

interface Watcher { s: Socket; states: RoomStateView[]; catches: CatchUpView[] }

/** A client that keeps its pointer level the way the browser does. */
function client(): Watcher {
  const s = connect(url, { transports: ['websocket'] });
  sockets.push(s);
  const w: Watcher = { s, states: [], catches: [] };
  s.on('roomState', (v: RoomStateView) => w.states.push(v));
  s.on('historyHead', (p: { seq: number }) => s.emit('ackHistory', { seq: p.seq }));
  s.on('catchUp', (p: CatchUpView) => w.catches.push(p));
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

const headOf = (code: string) => { const h = ctx.store.historyHead(code); return h.ok ? h.seq : -1; };
const cursorOf = (code: string, seat: number) => {
  const c = ctx.store.historyCursor(code, seat);
  return c.ok ? c.seq : -1;
};
const connectedOf = (code: string, seat: number) =>
  ctx.store.getRoom(code)!.players[seat]!.connected;

async function seatTwo(seed: number) {
  const room = ctx.store.createRoom({ seed });
  const a = client();
  const b = client();
  const ackA = await joinAck(a.s, { code: room.code, name: 'Mira' });
  const ackB = await joinAck(b.s, { code: room.code, name: 'Jonas' });
  expect([ackA.ok, ackB.ok]).toEqual([true, true]);
  a.s.emit('startGame');
  await waitFor(() => ctx.store.getRoom(room.code)!.phase === 'playing', 'the deal');
  return { code: room.code, a, b, tokenA: ackA.token! };
}

test('a return by token is counted with its gap; a fresh arrival is not a return', async () => {
  const before = {
    delta: await series(reg, 'ochre_catchups_served_total', 'outcome="delta"'),
    empty: await series(reg, 'ochre_catchups_served_total', 'outcome="empty"'),
    gaps: await series(reg, 'ochre_catchup_gap_transactions_count'),
    sum: await series(reg, 'ochre_catchup_gap_transactions_sum'),
  };
  const { code, a, tokenA } = await seatTwo(55);
  await waitFor(() => cursorOf(code, 0) === headOf(code), 'the deal to be acknowledged');
  // Two fresh joins have happened by now, and neither is a return: a new
  // arrival starts level with the head, so counting it would pad the series.
  expect(await series(reg, 'ochre_catchups_served_total', 'outcome="empty"')).toBe(before.empty);
  expect(await series(reg, 'ochre_catchup_gap_transactions_count')).toBe(before.gaps);

  a.s.disconnect();
  await waitFor(() => !connectedOf(code, 0), 'the seat to go dark');
  for (let i = 0; i < 3; i++) step(ctx.store, code);

  const back = client();
  expect(await joinAck(back.s, { code, token: tokenA })).toMatchObject({ ok: true, seat: 0 });
  await waitFor(() => back.catches.length > 0, 'the catch-up');
  expect(back.catches[0]!.entries).toHaveLength(3);

  expect(await series(reg, 'ochre_catchups_served_total', 'outcome="delta"')).toBe(before.delta + 1);
  expect(await series(reg, 'ochre_catchup_gap_transactions_count')).toBe(before.gaps + 1);
  expect(await series(reg, 'ochre_catchup_gap_transactions_sum')).toBe(before.sum + 3);
  // The event says how the return went and nothing else.
  expect(sent.filter(([n]) => n === 'catch_up').at(-1)).toEqual(['catch_up', { outcome: 'delta' }]);
});

test('a return with no gap is counted as the empty return it is', async () => {
  const before = await series(reg, 'ochre_catchups_served_total', 'outcome="empty"');
  const { code, a, tokenA } = await seatTwo(66);
  await waitFor(() => cursorOf(code, 0) === headOf(code), 'the deal to be acknowledged');
  a.s.disconnect();
  await waitFor(() => !connectedOf(code, 0), 'the seat to go dark');

  const back = client();
  expect(await joinAck(back.s, { code, token: tokenA })).toMatchObject({ ok: true, seat: 0 });
  await waitFor(() => back.states.length > 0, 'the snapshot');
  await settle();
  expect(back.catches).toEqual([]); // an empty account is worse than none
  expect(await series(reg, 'ochre_catchups_served_total', 'outcome="empty"')).toBe(before + 1);
});

test('a broken frame counts at the wire, a broken move counts at the rules', async () => {
  const beforeWire = await series(reg, 'ochre_wire_frames_rejected_total', 'reason="bad_request"');
  const { code, a } = await seatTwo(77);
  const rejections: string[] = [];
  a.s.on('moveRejected', (p: { reason: string }) => rejections.push(p.reason));

  a.s.emit('ackHistory', { seq: '__proto__' }); // never a frame a client can make
  a.s.emit('rematch'); // a real frame the rules turn down: the round is running
  await waitFor(() => rejections.length >= 2, 'both refusals');

  // The client hears the same kind of message for both — only the bookkeeping
  // tells them apart.
  expect(rejections).toContain('bad_request');
  expect(rejections).toContain('round_running');
  expect(await series(reg, 'ochre_wire_frames_rejected_total', 'reason="bad_request"')).toBe(beforeWire + 1);
  expect(await series(reg, 'ochre_moves_rejected_total', 'reason="bad_request"')).toBe(0);
  expect(await series(reg, 'ochre_moves_rejected_total', 'reason="round_running"')).toBe(1);
  expect(headOf(code)).toBeGreaterThan(0); // and the table played on regardless
});

test('the action budget answers for itself instead of hiding among the misclicks', async () => {
  const tight = await buildServer(new RoomStore(() => clock.ms), {
    create: new RateLimiter(1e9, 60_000), join: new RateLimiter(1e9, 60_000),
    pin: new RateLimiter(1e9, 60_000), action: new RateLimiter(2, 60_000),
  }, { analytics: ctx.analytics });
  await tight.app.listen({ port: 0 });
  try {
    const addr = tight.app.server.address();
    if (typeof addr === 'string' || addr === null) throw new Error('no port');
    const made = tight.store.createRoom({ seed: 89 });
    const s = connect(`http://127.0.0.1:${addr.port}`, { transports: ['websocket'] });
    sockets.push(s);
    const rejections: string[] = [];
    s.on('moveRejected', (p: { reason: string }) => rejections.push(p.reason));
    expect((await joinAck(s, { code: made.code, name: 'Mira' })).ok).toBe(true);

    const before = await series(reg, 'ochre_action_budget_exceeded_total');
    for (let i = 0; i < 5; i++) s.emit('startGame');
    await waitFor(() => rejections.filter((r) => r === 'rate_limited').length >= 3, 'the budget to bite');
    expect(await series(reg, 'ochre_action_budget_exceeded_total')).toBeGreaterThan(before);
    // Not in with the rules, where it used to sit and mean nothing.
    expect(await series(reg, 'ochre_moves_rejected_total', 'reason="rate_limited"')).toBe(0);
  } finally {
    await tight.app.close();
  }
});

test('session_ended after a rematch names the seat the player sits in now', async () => {
  const room = ctx.store.createRoom({ seed: 99 });
  const code = room.code;
  const mira = client();
  const jonas = client();
  const ada = client();
  const ackM = await joinAck(mira.s, { code, name: 'Mira' });
  const ackJ = await joinAck(jonas.s, { code, name: 'Jonas' });
  const ackA = await joinAck(ada.s, { code, name: 'Ada' });
  expect([ackM.seat, ackJ.seat, ackA.seat]).toEqual([0, 1, 2]);
  mira.s.emit('startGame');
  await waitFor(() => ctx.store.getRoom(code)!.phase === 'playing', 'the deal');

  // Jonas leaves for good, so the rematch has somebody to compact away.
  jonas.s.disconnect();
  await waitFor(() => !connectedOf(code, 1), 'the seat to go dark');
  clock.ms += CONTINUE_GRACE_MS + 1;
  mira.s.emit('continueWithout', { seat: 1 });
  await waitFor(() => ctx.store.getRoom(code)!.players[1]!.left, 'the removal');

  playToWin(ctx.store, code);
  mira.s.emit('rematch');
  await waitFor(() => ctx.store.getRoom(code)!.players.length === 2, 'the compaction');
  // Ada sat down in seat 2 and now sits in seat 1. Her socket still remembers 2.
  expect(ctx.store.getRoom(code)!.players[1]!.token).toBe(ackA.token);

  lines.length = 0;
  ada.s.disconnect();
  await waitFor(() => lines.some((l) => l.evt === 'session_ended'), 'the session to end');
  expect(lines.find((l) => l.evt === 'session_ended')).toMatchObject({ code, seat: 1 });
  // And the seat the stale number would have missed goes dark, instead of
  // staying lit forever with nobody behind it.
  await waitFor(() => !connectedOf(code, 1), 'the seat Ada actually holds');
  expect(ctx.store.getRoom(code)!.players[0]!.connected).toBe(true);
});

test('no room code, name, token, player id or card reaches a label or an event', async () => {
  const { code, a, tokenA } = await seatTwo(121);
  await waitFor(() => cursorOf(code, 0) === headOf(code), 'the deal to be acknowledged');
  for (let i = 0; i < 2; i++) step(ctx.store, code);
  a.s.emit('ackHistory', { seq: '__proto__' }); // one of every kind of refusal
  a.s.emit('rematch');
  await settle();

  const room = ctx.store.getRoom(code)!;
  const secrets = [
    code, tokenA,
    ...room.players.map((p) => p.name),
    ...room.players.map((p) => p.token),
    ...room.players.map((p) => p.id),
  ];
  const dumps = {
    registry: JSON.stringify(await reg.getMetricsAsJSON()),
    text: await reg.metrics(),
    served: (await ctx.app.inject({ method: 'GET', url: '/metrics' })).body,
    events: JSON.stringify(sent),
  };
  expect(dumps.registry).toContain('ochre_catchups_served_total');
  expect(dumps.served).toContain('ochre_history_lag_transactions_max');
  expect(dumps.events.length).toBeGreaterThan(2);
  for (const secret of secrets) {
    expect(secret.length).toBeGreaterThan(3); // a check on the check
    for (const [where, dump] of Object.entries(dumps)) {
      expect(`${where}:${dump.includes(secret)}`).toBe(`${where}:false`);
    }
  }

  // Cards never had a door into this layer, and this is what keeps it shut:
  // every label the registry carries is a word out of a fixed dictionary.
  const KNOWN = new Set([
    'delta', 'empty', 'truncated', 'failed',
    'turn_out_of_range', 'turn_on_removed', 'no_seats_left',
    'bad_request', 'table_not_found', 'bad_pin', 'bad_stack', 'wild_needs_color',
    'no_such_seat', 'other',
    'wrong_pin', 'pin_required', 'table_full', 'game_started', 'rate_limited',
    'already_seated', 'seat_not_found', 'server_error',
    'round_running', 'no_round', 'not_enough_players', 'host_only_deal',
    'host_only_rules', 'rules_locked', 'already_dealt', 'need_two_players',
    'not_your_turn', 'card_no_match', 'card_not_in_hand', 'bad_seat', 'round_over',
    'answer_pot', 'force_play', 'nothing_to_pass', 'cannot_call_now',
    'nothing_to_catch', 'cannot_catch_self', 'play_drawn_or_pass',
    'choose_color_first', 'no_color_pending', 'bad_cursor', 'cursor_ahead',
    'player_connected', 'grace_running',
  ]);
  const carried = await labelsOf(reg);
  expect(carried.length).toBeGreaterThan(0);
  for (const { label, value } of carried) {
    expect(['reason', 'outcome', 'kind']).toContain(label);
    expect(`${value}:${KNOWN.has(value)}`).toBe(`${value}:true`);
  }
});
