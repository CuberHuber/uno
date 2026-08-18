import Fastify, { LogController, type FastifyServerOptions } from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Registry } from 'prom-client';
import type { ClientToServerEvents, ServerToClientEvents, Rules } from '@uno/shared';
import { RateLimiter } from './limiter.js';
import { RoomStore } from './rooms.js';
import { attachSockets } from './sockets.js';
import { Analytics } from './analytics.js';
import { registerGameMetrics } from './metrics.js';

export interface ServerLimits { create: RateLimiter; join: RateLimiter; pin: RateLimiter }
export const defaultLimits = (): ServerLimits => ({
  create: new RateLimiter(10, 60_000),
  join: new RateLimiter(20, 60_000),
  pin: new RateLimiter(5, 60_000),
});

export interface BuildOptions {
  logger?: FastifyServerOptions['logger'];
  analytics?: Analytics;
}

export async function buildServer(
  store = new RoomStore(),
  limits: ServerLimits = defaultLimits(),
  opts: BuildOptions = {},
) {
  // Request logging stays off even with a logger: the interesting traffic is
  // websockets, and per-asset HTTP lines would drown the game events.
  const app = Fastify({
    logger: opts.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
  });
  const register = new Registry();
  const analytics = opts.analytics ?? new Analytics({ log: app.log, register });
  registerGameMetrics(register, store, analytics);

  app.post('/api/rooms', async (req, reply) => {
    if (!limits.create.allow(req.ip)) return reply.code(429).send({ error: 'rate_limited' });
    // Fastify parses a body only when a content-type header is present, so the
    // Landing's bare POST keeps working; a malformed pin makes an open room.
    const body = (req.body ?? {}) as { rules?: Partial<Rules>; pin?: string };
    const pin = typeof body.pin === 'string' && /^\d{4}$/.test(body.pin) ? body.pin : null;
    const room = store.createRoom({ rules: body.rules, pin });
    analytics.roomCreated(room.code);
    return { code: room.code };
  });

  app.get('/healthz', async () => ({
    ok: true,
    uptimeS: Math.round(process.uptime()),
    ...store.stats(),
  }));

  // Machine endpoint for an external Prometheus scraper (e.g. Grafana Cloud's
  // agentless Metrics Endpoint integration); humans never look at it directly.
  app.get('/metrics', async (_req, reply) => {
    reply.type(register.contentType);
    return register.metrics();
  });

  // Runtime analytics config: the client reads window.__OE_CONF before its
  // bundle runs, so keys are set in the hosting panel's env vars (Timeweb App
  // Platform applies env at launch, not at Docker build) without a rebuild.
  app.get('/config.js', async (_req, reply) => {
    const conf = {
      umamiWebsiteId: process.env.UMAMI_WEBSITE_ID ?? null,
      umamiSrc: process.env.UMAMI_SRC ?? null,
      umamiDomains: process.env.UMAMI_DOMAINS ?? null,
      gaGameKey: process.env.GA_GAME_KEY ?? null,
      gaSecretKey: process.env.GA_SECRET_KEY ?? null,
    };
    reply.type('application/javascript').header('cache-control', 'no-store');
    return `window.__OE_CONF=${JSON.stringify(conf)};`;
  });

  // import.meta.dirname needs Node 20.11+; derive it portably so Node 18 dev machines work too.
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, { root: publicDir, wildcard: false });
    app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html')); // SPA: /r/CODE
  }

  await app.ready();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server);
  attachSockets(io, store, limits, analytics);
  return { app, io, store, limits, analytics };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prod = process.env.NODE_ENV === 'production';
  const logger: FastifyServerOptions['logger'] = {
    level: process.env.LOG_LEVEL ?? 'info',
    // Room PINs and seat tokens must never reach the log stream.
    redact: { paths: ['pin', '*.pin', 'token', '*.token', 'req.headers.authorization'], censor: '[redacted]' },
    ...(prod ? {} : {
      transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } },
    }),
  };
  // RATE_LIMITS=off exists for local load testing (bench/ws.mjs spins up more
  // rooms and joins per minute than any human ever would). Never set it in prod.
  const limits = process.env.RATE_LIMITS === 'off'
    ? {
        create: new RateLimiter(1e9, 60_000), join: new RateLimiter(1e9, 60_000),
        pin: new RateLimiter(1e9, 60_000),
      }
    : defaultLimits();
  const { app, store } = await buildServer(undefined, limits, { logger });
  setInterval(() => {
    store.sweep();
    limits.create.sweep(); limits.join.sweep(); limits.pin.sweep();
  }, 60_000).unref();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`Ochre Eights listening on :${port}`);
}
