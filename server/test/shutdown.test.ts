import { expect, test, vi } from 'vitest';
import { io as connect } from 'socket.io-client';
import type { FastifyBaseLogger } from 'fastify';
import { buildServer, createShutdownHandler } from '../src/server.js';
import { RoomStore } from '../src/rooms.js';

test('SIGTERM drains socket.io and Fastify, then exits 0', { timeout: 10_000 }, async () => {
  const ctx = await buildServer(new RoomStore());
  await ctx.app.listen({ port: 0 });
  const address = ctx.app.server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  const client = connect(`http://127.0.0.1:${address.port}`, { transports: ['websocket'] });
  await new Promise<void>((resolve) => client.on('connect', () => resolve()));

  const disconnected = new Promise<void>((resolve) => client.on('disconnect', () => resolve()));
  let resolveExit!: (code: number) => void;
  const exited = new Promise<number>((resolve) => { resolveExit = resolve; });
  const handler = createShutdownHandler(ctx.app, ctx.io, { exit: resolveExit });

  handler('SIGTERM');
  expect(await exited).toBe(0);
  await disconnected; // the open websocket was dropped, not left dangling
  expect(ctx.app.server.listening).toBe(false);
  client.disconnect();
});

test('a second signal while draining neither double-closes nor double-exits', async () => {
  const info = vi.fn();
  const log = { info, error: vi.fn() } as unknown as FastifyBaseLogger;
  let closes = 0;
  const app = { log, close: () => { closes += 1; return Promise.resolve(); } };
  const io = { close: (cb?: (err?: Error) => void) => cb?.() };
  const exits: number[] = [];

  const handler = createShutdownHandler(app, io, { exit: (code) => exits.push(code) });
  handler('SIGTERM');
  handler('SIGINT'); // e.g. platform stop plus a stray Ctrl-C
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(closes).toBe(1);
  expect(exits).toEqual([0]);
  expect(info).toHaveBeenCalledTimes(1);
  expect(info).toHaveBeenCalledWith({ sig: 'SIGTERM' }, 'shutdown');
});

test('a hung close trips the watchdog and hard-exits 1', async () => {
  const log = { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
  const app = { log, close: () => new Promise(() => {}) }; // close never settles
  const io = { close: () => {} }; // callback never fires
  const exits: number[] = [];

  const handler = createShutdownHandler(app, io, { timeoutMs: 20, exit: (code) => exits.push(code) });
  handler('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 80));

  expect(exits).toEqual([1]);
});
