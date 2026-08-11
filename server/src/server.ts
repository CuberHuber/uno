import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ClientToServerEvents, ServerToClientEvents } from '@uno/shared';
import { RoomStore } from './rooms.js';
import { attachSockets } from './sockets.js';

export async function buildServer(store = new RoomStore()) {
  const app = Fastify();

  app.post('/api/rooms', async () => {
    const room = store.createRoom();
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
  attachSockets(io, store);
  return { app, io, store };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { app, store } = await buildServer();
  setInterval(() => store.sweep(), 60_000).unref();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Ochre Eights listening on :${port}`);
}
