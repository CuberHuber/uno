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

async function metric(name: string): Promise<number | null> {
  const res = await ctx.app.inject({ method: 'GET', url: '/metrics' });
  const m = res.body.match(new RegExp(`^${name} (\\d+(?:\\.\\d+)?)$`, 'm'));
  return m ? Number(m[1]) : null;
}

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

test('config.js reflects server env at request time', async () => {
  const prev = process.env.UMAMI_WEBSITE_ID;
  const prevGa = process.env.GA_GAME_KEY;
  process.env.UMAMI_WEBSITE_ID = 'site-123';
  delete process.env.GA_GAME_KEY;
  try {
    const res = await ctx.app.inject({ method: 'GET', url: '/config.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toContain('window.__OE_CONF=');
    expect(res.body).toContain('"site-123"');
    expect(res.body).toContain('"gaGameKey":null');
  } finally {
    if (prev === undefined) delete process.env.UMAMI_WEBSITE_ID;
    else process.env.UMAMI_WEBSITE_ID = prev;
    if (prevGa !== undefined) process.env.GA_GAME_KEY = prevGa;
  }
});

test('room creation over HTTP is counted', async () => {
  const res = await ctx.app.inject({ method: 'POST', url: '/api/rooms' });
  expect(res.statusCode).toBe(200);
  expect(await metric('ochre_rooms_created_total')).toBe(1);
});

test('a played round lands in the metrics: joins, rounds, sessions', { timeout: 30_000 }, async () => {
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

  expect(await metric('ochre_players_joined_total')).toBe(2);
  expect(await metric('ochre_rounds_started_total')).toBe(1);
  expect(await metric('ochre_rounds_finished_total')).toBe(1);
  expect(await metric('ochre_round_duration_seconds_count')).toBe(1);

  a.disconnect();
  b.disconnect();
  await waitFor(() => ctx.analytics.activeSessions() === 0);
  expect(await metric('ochre_session_duration_seconds_count')).toBe(2);
});
