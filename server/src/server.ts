import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ClientToServerEvents, ServerToClientEvents, Rules } from '@uno/shared';
import { RateLimiter } from './limiter.js';
import { RoomStore } from './rooms.js';
import { attachSockets } from './sockets.js';

export interface ServerLimits { create: RateLimiter; join: RateLimiter; pin: RateLimiter }
export const defaultLimits = (): ServerLimits => ({
  create: new RateLimiter(10, 60_000),
  join: new RateLimiter(20, 60_000),
  pin: new RateLimiter(5, 60_000),
});

export async function buildServer(store = new RoomStore(), limits: ServerLimits = defaultLimits()) {
  const app = Fastify();

  app.post('/api/rooms', async (req, reply) => {
    if (!limits.create.allow(req.ip)) return reply.code(429).send({ error: 'rate_limited' });
    // Fastify parses a body only when a content-type header is present, so the
    // Landing's bare POST keeps working; a malformed pin makes an open room.
    const body = (req.body ?? {}) as { rules?: Partial<Rules>; pin?: string };
    const pin = typeof body.pin === 'string' && /^\d{4}$/.test(body.pin) ? body.pin : null;
    const room = store.createRoom({ rules: body.rules, pin });
    return { code: room.code };
  });

  // import.meta.dirname needs Node 20.11+; derive it portably so Node 18 dev machines work too.
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, { root: publicDir, wildcard: false });
    app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html')); // SPA: /r/CODE
  }

  await app.ready();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server);
  attachSockets(io, store, limits);
  return { app, io, store, limits };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { app, store, limits } = await buildServer();
  setInterval(() => {
    store.sweep();
    limits.create.sweep(); limits.join.sweep(); limits.pin.sweep();
  }, 60_000).unref();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Ochre Eights listening on :${port}`);
}
