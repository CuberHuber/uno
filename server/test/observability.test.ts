import { afterAll, beforeAll, expect, test } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { isPlayable, type RoomStateView } from '@uno/shared';
import { buildServer } from '../src/server.js';
import { RoomStore } from '../src/rooms.js';

let ctx: Awaited<ReturnType<typeof buildServer>>;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  ctx = await buildServer(new RoomStore());
  await ctx.app.listen({ port: 0 });
  const address = ctx.app.server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  url = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await ctx.app.close();
});

async function waitFor(cond: () => boolean, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 25));
  }
}

test('healthz reports ok with live room counts', async () => {
  const res = await ctx.app.inject({ method: 'GET', url: '/healthz' });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.ok).toBe(true);
  expect(typeof body.uptimeS).toBe('number');
  expect(typeof body.rooms).toBe('number');
});

test('metrics exposes node runtime and game series', async () => {
  const res = await ctx.app.inject({ method: 'GET', url: '/metrics' });
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain('ochre_rooms_open');
  expect(res.body).toContain('ochre_sockets_connected');
  expect(res.body).toContain('nodejs_');
});

test('visit beacon validates payloads and counts uniques', async () => {
  const bad = await ctx.app.inject({
    method: 'POST', url: '/api/analytics/event', payload: { type: 'visit', vid: 'x' },
  });
  expect(bad.statusCode).toBe(400);
  const wrongType = await ctx.app.inject({
    method: 'POST', url: '/api/analytics/event', payload: { type: 'click', vid: 'visitor-aaaa-1111' },
  });
  expect(wrongType.statusCode).toBe(400);
  for (const vid of ['visitor-aaaa-1111', 'visitor-aaaa-1111', 'visitor-bbbb-2222']) {
    const ok = await ctx.app.inject({ method: 'POST', url: '/api/analytics/event', payload: { type: 'visit', vid } });
    expect(ok.statusCode).toBe(204);
  }
  expect(ctx.analytics.summary().players.uniqueToday).toBe(2);
  expect(ctx.analytics.summary().visits).toBe(3);
});

test('admin stats: 404 when unset, 401 on bad token, summary with the right one', async () => {
  const prev = process.env.ADMIN_TOKEN;
  delete process.env.ADMIN_TOKEN;
  try {
    const off = await ctx.app.inject({ method: 'GET', url: '/api/admin/stats' });
    expect(off.statusCode).toBe(404);

    process.env.ADMIN_TOKEN = 'sesame';
    const missing = await ctx.app.inject({ method: 'GET', url: '/api/admin/stats' });
    expect(missing.statusCode).toBe(401);
    const wrong = await ctx.app.inject({
      method: 'GET', url: '/api/admin/stats', headers: { authorization: 'Bearer nope' },
    });
    expect(wrong.statusCode).toBe(401);

    const ok = await ctx.app.inject({
      method: 'GET', url: '/api/admin/stats', headers: { authorization: 'Bearer sesame' },
    });
    expect(ok.statusCode).toBe(200);
    const s = ok.json();
    expect(s.rounds).toBeDefined();
    expect(s.players).toBeDefined();
    expect(s.now.rooms).toBeGreaterThanOrEqual(0);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = prev;
  }
});

test('admin panel page is served', async () => {
  const res = await ctx.app.inject({ method: 'GET', url: '/admin' });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toContain('text/html');
  expect(res.body).toContain('table service');
});

test('room creation over HTTP is counted', async () => {
  const before = ctx.analytics.summary().rooms.created;
  const res = await ctx.app.inject({ method: 'POST', url: '/api/rooms' });
  expect(res.statusCode).toBe(200);
  expect(ctx.analytics.summary().rooms.created).toBe(before + 1);
});

test('a played round lands in analytics: joins, rounds, sessions', { timeout: 30_000 }, async () => {
  const room = ctx.store.createRoom({ seed: 7 });
  let winner: number | null = null;
  const a = connect(url, { transports: ['websocket'] });
  const b = connect(url, { transports: ['websocket'] });
  sockets.push(a, b);

  const drive = (view: RoomStateView) => {
    if (view.winnerSeat !== null) { winner = view.winnerSeat; return; }
    if (view.turnSeat !== view.yourSeat || view.paused) return;
    const sock = view.yourSeat === 0 ? a : b;
    if (view.mustChooseColor) return void sock.emit('chooseColor', { color: 'red' });
    if (view.pendingDrawnCardId !== null) {
      return void sock.emit('playCards', { cardIds: [view.pendingDrawnCardId], chosenColor: 'red' });
    }
    const playable = view.hand.find((c) => isPlayable(c, view.topCard!, view.currentColor));
    if (playable) {
      const needsColor = playable.value === 'wild' || playable.value === 'wild4';
      sock.emit('playCards', { cardIds: [playable.id], chosenColor: needsColor ? 'red' : undefined });
    } else {
      sock.emit('drawCard');
    }
  };
  a.on('roomState', drive);
  b.on('roomState', drive);

  const join = (s: Socket, name: string) =>
    new Promise<{ ok: boolean }>((resolve) => s.emit('joinRoom', { code: room.code, name }, resolve));
  expect((await join(a, 'Mira')).ok).toBe(true);
  expect((await join(b, 'Jonas')).ok).toBe(true);

  a.emit('startGame');
  await waitFor(() => winner !== null, 25_000);

  const played = ctx.analytics.summary();
  expect(played.rooms.playersJoined).toBeGreaterThanOrEqual(2);
  expect(played.rounds.started).toBeGreaterThanOrEqual(1);
  expect(played.rounds.finished).toBeGreaterThanOrEqual(1);

  const sessionsBefore = played.sessions.count;
  a.disconnect();
  b.disconnect();
  await waitFor(() => ctx.analytics.summary().sessions.count >= sessionsBefore + 2);
});
