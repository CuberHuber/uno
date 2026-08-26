import { EventEmitter } from 'node:events';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { buildServer, defaultLimits, installProcessGuards } from '../src/server.js';
import { RoomStore } from '../src/rooms.js';
import { RateLimiter } from '../src/limiter.js';
import {
  MAX_CARD_IDS, isSeat, isSeq, parseAck, parseColor, parseJoin, parsePin, parsePlay, parseRules,
  parseSeat,
} from '../src/wire.js';

// ── parsers ──────────────────────────────────────────────────────────────────

test('a seat is an array index or nothing at all', () => {
  for (const hostile of ['__proto__', 'length', '1', '0', 1.5, -1, NaN, Infinity, 2 ** 53, null, undefined, {}, []]) {
    expect(isSeat(hostile)).toBe(false);
    expect(parseSeat({ seat: hostile })).toEqual({ ok: false, error: 'no_such_seat' });
  }
  expect(parseSeat({ seat: 0 })).toEqual({ ok: true, value: { seat: 0 } });
  expect(parseSeat({ seat: 3 })).toEqual({ ok: true, value: { seat: 3 } });
  expect(parseSeat(undefined).ok).toBe(false);
});

test('a journal number is a whole count or nothing at all', () => {
  // The same class of value as the seat guard turns away, for the same reason:
  // this number is compared and it is arithmetic. `'1' > 0` passes, `1.5` would
  // wedge a pointer between two transactions, `NaN` poisons the `Math.max` the
  // store advances the pointer with, and `2 ** 53` is where whole numbers stop
  // being distinct.
  for (const hostile of ['__proto__', 'length', '1', '0', '', 1.5, -1, NaN, Infinity,
    2 ** 53, null, undefined, {}, [], true]) {
    expect(isSeq(hostile)).toBe(false);
    expect(parseAck({ seq: hostile })).toEqual({ ok: false, error: 'bad_request' });
  }
  expect(isSeq(0)).toBe(true);
  expect(parseAck({ seq: 0 })).toEqual({ ok: true, value: { seq: 0 } });
  expect(parseAck({ seq: 42 })).toEqual({ ok: true, value: { seq: 42 } });
  // The largest number that still counts one at a time is legal; the next is not.
  expect(parseAck({ seq: Number.MAX_SAFE_INTEGER }).ok).toBe(true);
  expect(parseAck({ seq: Number.MAX_SAFE_INTEGER + 1 }).ok).toBe(false);
  for (const shape of [undefined, null, 7, 'ok', []]) expect(parseAck(shape).ok).toBe(false);
  expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'seq')).toBe(false);
});

test('cardIds must be a bounded array of whole ids', () => {
  const refused = ['bad_stack'];
  for (const hostile of [null, undefined, 'x', 7, {}, [], ['1'], [1.5], [-1], [NaN], [1, null]]) {
    expect(parsePlay({ cardIds: hostile }).ok).toBe(false);
    expect(refused).toContain((parsePlay({ cardIds: hostile }) as { error: string }).error);
  }
  const oversized = Array.from({ length: MAX_CARD_IDS + 1 }, (_, i) => i);
  expect(parsePlay({ cardIds: oversized })).toEqual({ ok: false, error: 'bad_stack' });
  expect(parsePlay({ cardIds: [4, 9] })).toEqual({ ok: true, value: { cardIds: [4, 9] } });
});

test('a colour is one of four, on play and on choose', () => {
  for (const hostile of ['purple', 'RED', '', 0, null, {}]) {
    expect(parseColor({ color: hostile })).toEqual({ ok: false, error: 'wild_needs_color' });
  }
  expect(parseColor({ color: 'red' })).toEqual({ ok: true, value: { color: 'red' } });
  expect(parsePlay({ cardIds: [1], chosenColor: 'purple' }))
    .toEqual({ ok: false, error: 'wild_needs_color' });
  expect(parsePlay({ cardIds: [1], chosenColor: 'blue' }))
    .toEqual({ ok: true, value: { cardIds: [1], chosenColor: 'blue' } });
  // An absent colour is legal — only a wild needs one, and the engine says so.
  expect(parsePlay({ cardIds: [1] }).ok).toBe(true);
  expect(parsePlay({ cardIds: [1], chosenColor: null }).ok).toBe(true);
});

test('join fields: a missing payload is a refusal, not a crash', () => {
  expect(parseJoin(undefined)).toEqual({ ok: false, error: 'bad_request' });
  expect(parseJoin(null).ok).toBe(false);
  expect(parseJoin('AB3CD').ok).toBe(false);
  expect(parseJoin({}).ok).toBe(false);
  expect(parseJoin({ code: 123 })).toEqual({ ok: false, error: 'table_not_found' });
  expect(parseJoin({ code: 'x'.repeat(33) }).ok).toBe(false);
  expect(parseJoin({ code: 'AB3CD', name: 42 })).toEqual({ ok: false, error: 'bad_request' });
  expect(parseJoin({ code: 'AB3CD', token: 42 })).toEqual({ ok: false, error: 'bad_request' });
  expect(parseJoin({ code: 'AB3CD', pin: 1234 })).toEqual({ ok: false, error: 'bad_pin' });
  // Normalised like the store normalises, and an absent PIN stays absent so the
  // join screen still gets `pin_required` rather than `wrong_pin`.
  expect(parseJoin({ code: ' ab3-cd ' })).toEqual({ ok: true, value: { code: 'AB3CD', name: 'Player' } });
  expect(parseJoin({ code: 'AB3CD', name: 'Mira', token: 't', pin: '1234' }))
    .toEqual({ ok: true, value: { code: 'AB3CD', name: 'Mira', token: 't', pin: '1234' } });
});

test('rules are four booleans, a pin is a string or null', () => {
  expect(parseRules({}).ok).toBe(false);
  expect(parseRules({ rules: 'all' }).ok).toBe(false);
  expect(parseRules({ rules: { stacking: 1, evil: true } })).toEqual({
    ok: true,
    value: { rules: { stacking: true, forcePlay: false, drawToMatch: false, multiDiscard: false } },
  });
  expect(parsePin({ pin: null })).toEqual({ ok: true, value: { pin: null } });
  expect(parsePin({ pin: 1234 })).toEqual({ ok: false, error: 'bad_pin' });
  expect(parsePin({})).toEqual({ ok: false, error: 'bad_pin' });
  expect(parsePin({ pin: '1234' })).toEqual({ ok: true, value: { pin: '1234' } });
});

test('in-game actions carry a budget by default', () => {
  expect(defaultLimits().action).toBeInstanceOf(RateLimiter);
});

test('an escaping throw is logged, not fatal', () => {
  const logged: object[] = [];
  const bus = new EventEmitter();
  installProcessGuards({ error: (obj) => { logged.push(obj); } }, bus);
  bus.emit('uncaughtException', new Error('one malformed frame'));
  bus.emit('unhandledRejection', new Error('a dropped promise'));
  expect(logged).toHaveLength(2);
  expect(bus.listenerCount('uncaughtException')).toBe(1);
});

// ── the same frames, over a real socket ──────────────────────────────────────

const ACTION_BUDGET = 20;
let ctx: Awaited<ReturnType<typeof buildServer>>;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  const wide = () => new RateLimiter(1e9, 60_000);
  ctx = await buildServer(new RoomStore(), {
    // Entry limiters out of the way (one IP runs every client here); the action
    // budget is the one under test, shrunk so the test needs 25 frames, not 130.
    create: wide(), join: wide(), pin: wide(), action: new RateLimiter(ACTION_BUDGET, 60_000),
  });
  await ctx.app.listen({ port: 0 });
  const address = ctx.app.server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  url = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await ctx.app.close();
});

function client(): Socket {
  const s = connect(url, { transports: ['websocket'] });
  sockets.push(s);
  return s;
}

type Ack = { ok: boolean; error?: string; seat?: number; token?: string };
const send = (s: Socket, event: string, ...args: unknown[]): void => { s.emit(event, ...args); };
const ackOf = (s: Socket, event: string, ...args: unknown[]) =>
  new Promise<Ack>((resolve) => s.emit(event, ...args, resolve));
const nextRejection = (s: Socket) =>
  new Promise<string>((resolve) => s.once('moveRejected', (p: { reason: string }) => resolve(p.reason)));
const settle = () => new Promise((r) => setTimeout(r, 60));

async function seat(code: string, name = 'Mira'): Promise<{ s: Socket; ack: Ack }> {
  const s = client();
  const ack = await ackOf(s, 'joinRoom', { code, name });
  expect(ack.ok).toBe(true);
  return { s, ack };
}

test('joinRoom with no payload and no ack does not take the process down', async () => {
  const room = ctx.store.createRoom();
  const rude = client();
  await new Promise<void>((resolve) => rude.on('connect', () => resolve()));
  send(rude, 'joinRoom');                       // args = [], p and ack both undefined
  send(rude, 'joinRoom', { code: room.code });  // a payload, still no callback
  send(rude, 'joinRoom', { code: 123 }, 'not-a-function');
  await settle();
  // The instance is still serving every other room.
  const other = ctx.store.createRoom();
  expect((await ackOf(client(), 'joinRoom', { code: other.code, name: 'Jonas' })).ok).toBe(true);
});

test('malformed join payloads are refused through the ack', async () => {
  const c = client();
  expect((await ackOf(c, 'joinRoom')).error).toBe('bad_request');
  expect((await ackOf(c, 'joinRoom', { code: 123 })).error).toBe('table_not_found');
  expect((await ackOf(c, 'joinRoom', { code: 'ZZZZZ' })).error).toBe('table_not_found');
});

test('a seated socket cannot poison the store with a string seat', async () => {
  const room = ctx.store.createRoom();
  const { s } = await seat(room.code);
  for (const hostile of ['__proto__', 'length', '1']) {
    const rejected = nextRejection(s);
    send(s, 'continueWithout', { seat: hostile });
    expect(await rejected).toBe('no_such_seat');
  }
  const rejected = nextRejection(s);
  send(s, 'continueWithout');
  expect(await rejected).toBe('no_such_seat');
  expect('left' in []).toBe(false); // Array.prototype untouched
  expect(ctx.store.getRoom(room.code)!.players[0]!.left).toBe(false);
});

test('play and colour frames are refused at the boundary', async () => {
  const room = ctx.store.createRoom();
  const { s } = await seat(room.code);
  const cases: [string, unknown, string][] = [
    ['playCards', { cardIds: null }, 'bad_stack'],
    ['playCards', undefined, 'bad_request'],
    ['playCards', { cardIds: Array.from({ length: 200 }, (_, i) => i) }, 'bad_stack'],
    ['playCards', { cardIds: [1], chosenColor: 'purple' }, 'wild_needs_color'],
    ['chooseColor', { color: 'purple' }, 'wild_needs_color'],
    ['chooseColor', undefined, 'wild_needs_color'],
    ['setRules', { rules: 'all' }, 'bad_request'],
    ['setPin', { pin: 1234 }, 'bad_pin'],
  ];
  for (const [event, payload, reason] of cases) {
    const rejected = nextRejection(s);
    send(s, event, payload);
    expect([event, await rejected]).toEqual([event, reason]);
  }
});

test('one socket holds one seat', async () => {
  const room = ctx.store.createRoom();
  const other = ctx.store.createRoom();
  const { s, ack } = await seat(room.code);
  // A repeat join of the same table is idempotent: same seat, no second player,
  // whatever token the client happens to send with it.
  const again = await ackOf(s, 'joinRoom', { code: room.code, name: 'Mira' });
  expect([again.ok, again.seat, again.token]).toEqual([true, ack.seat, ack.token]);
  const stale = await ackOf(s, 'joinRoom', { code: room.code, token: 'a-token-from-last-week' });
  expect([stale.ok, stale.seat, stale.token]).toEqual([true, ack.seat, ack.token]);
  expect(ctx.store.getRoom(room.code)!.players).toHaveLength(1);
  // A second table on the same socket would orphan the first seat.
  expect((await ackOf(s, 'joinRoom', { code: other.code, name: 'Mira' })).error).toBe('already_seated');
  expect(ctx.store.getRoom(other.code)!.players).toHaveLength(0);
});

test('a dead socket cannot darken the seat its replacement already holds', async () => {
  const room = ctx.store.createRoom();
  const { s: a, ack } = await seat(room.code);
  // The handover a Wi-Fi→LTE move makes: the new socket resumes with the token.
  const b = client();
  expect((await ackOf(b, 'joinRoom', { code: room.code, token: ack.token })).seat).toBe(ack.seat);
  const player = ctx.store.getRoom(room.code)!.players[0]!;
  expect(player.connected).toBe(true);

  const seenByB = new Promise<void>((resolve) => b.once('roomState', () => resolve()));
  a.disconnect();
  await seenByB; // the late disconnect has been processed by now
  expect(player.connected).toBe(true);
  expect(player.socketId).not.toBeNull();
});

test('in-game actions run out of budget before the event loop does', async () => {
  const room = ctx.store.createRoom();
  const { s } = await seat(room.code);
  const reasons: string[] = [];
  s.on('moveRejected', (p: { reason: string }) => reasons.push(p.reason));
  const flood = ACTION_BUDGET + 5;
  for (let i = 0; i < flood; i++) send(s, 'drawCard');
  await new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const check = setInterval(() => {
      if (reasons.length >= flood) { clearInterval(check); resolve(); }
      else if (Date.now() - started > 5_000) { clearInterval(check); reject(new Error('no answers')); }
    }, 20);
  });
  expect(reasons.slice(0, ACTION_BUDGET).every((r) => r === 'no_round')).toBe(true);
  expect(reasons.slice(ACTION_BUDGET).every((r) => r === 'rate_limited')).toBe(true);
});
