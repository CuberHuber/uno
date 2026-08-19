import Fastify, {
  LogController,
  type FastifyBaseLogger, type FastifyError, type FastifyReply, type FastifyRequest, type FastifyServerOptions,
} from 'fastify';
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
import { registerGaRelay } from './ga-relay.js';
import { createUmamiSender } from './umami.js';

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

/** Uncaught route errors: full detail (message and stack) goes to pino, an
 *  opaque JSON goes to the wire — internals never leak to a client. Errors
 *  that already carry a 4xx status (body parser, bodyLimit, rate caps) keep
 *  it, reduced to their machine-readable code. */
export function routeErrorHandler(err: FastifyError, req: FastifyRequest, reply: FastifyReply): void {
  const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
  if (status >= 500) {
    req.log.error({ err, method: req.method, url: req.url }, 'unhandled route error');
    void reply.code(500).send({ error: 'internal_error' });
  } else {
    req.log.warn({ code: err.code, method: req.method, url: req.url, status }, 'request refused');
    void reply.code(status).send({ error: err.code ?? 'request_refused' });
  }
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
  app.setErrorHandler(routeErrorHandler);
  const register = new Registry();
  const analytics = opts.analytics
    ?? new Analytics({ log: app.log, register, sendEvent: createUmamiSender({ log: app.log }) });
  registerGameMetrics(register, store, analytics);
  registerGaRelay(app);

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
      // GA_SECRET_KEY stays server-side by design: the browser SDK talks to
      // POST /api/ga/*, where the relay signs with the real secret.
      // Feeds GameAnalytics configureBuild, so dashboards can compare deploys.
      appVersion: process.env.APP_VERSION ?? null,
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

export interface ShutdownOptions {
  /** Hard-exit guard: how long a hung close may stall before process death. */
  timeoutMs?: number;
  /** Test seam; defaults to process.exit. */
  exit?: (code: number) => void;
}

/** Deploys send SIGTERM; without this the container is killed mid-round with
 *  sockets dangling. The handler drains socket.io first (open websockets keep
 *  the HTTP server from ever closing), then Fastify, then exits 0 — and a
 *  watchdog timer hard-exits 1 so a hung close can't block the platform's
 *  stop sequence. Repeat signals while draining are ignored. */
export function createShutdownHandler(
  app: { log: FastifyBaseLogger; close: () => PromiseLike<unknown> },
  io: { close: (cb?: (err?: Error) => void) => unknown },
  opts: ShutdownOptions = {},
): (sig: NodeJS.Signals) => void {
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const timeoutMs = opts.timeoutMs ?? 5_000;
  let shuttingDown = false;
  return (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ sig }, 'shutdown');
    const watchdog = setTimeout(() => exit(1), timeoutMs);
    watchdog.unref();
    io.close(() => {
      Promise.resolve(app.close()).then(
        () => exit(0),
        (err: unknown) => { app.log.error({ err }, 'shutdown close failed'); exit(1); },
      );
    });
  };
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
  const { app, io, store, analytics } = await buildServer(undefined, limits, { logger });
  setInterval(() => {
    store.sweep((code) => analytics.roomClosed(code));
    limits.create.sweep(); limits.join.sweep(); limits.pin.sweep();
  }, 60_000).unref();
  const shutdown = createShutdownHandler(app, io);
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => shutdown(sig));
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`Ochre Eights listening on :${port}`);
}
