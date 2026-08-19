import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { RateLimiter } from './limiter.js';

export interface GaRelayOptions {
  env?: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
  limiter?: RateLimiter;
  timeoutMs?: number;
}

const GA_ORIGIN = 'https://api.gameanalytics.com';
// The browser SDK flushes small batches; 64 KB leaves an order of magnitude
// of headroom while refusing junk uploads outright.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH = 100;

/** GameAnalytics relay: the browser SDK posts to /api/ga/* on our own domain
 *  (adblockers cut api.gameanalytics.com), and the server re-signs the body
 *  with GA_SECRET_KEY — which never reaches a browser — before forwarding to
 *  the Collection API. The client's own Authorization header is placeholder-
 *  signed and ignored. Re-serializing the parsed body is the sanitizer:
 *  only our own JSON encoding is ever signed and forwarded. */
export function registerGaRelay(app: FastifyInstance, opts: GaRelayOptions = {}): void {
  const env = opts.env ?? process.env;
  const limiter = opts.limiter ?? new RateLimiter(120, 60_000);
  const timeoutMs = opts.timeoutMs ?? 3_000;

  const forward = async (reply: FastifyReply, path: string, body: string): Promise<unknown> => {
    const auth = createHmac('sha256', env.GA_SECRET_KEY!).update(body).digest('base64');
    const fetchFn = opts.fetchFn ?? fetch;
    try {
      const res = await fetchFn(`${GA_ORIGIN}${path}`, {
        method: 'POST',
        headers: { authorization: auth, 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      // Pass the collector's verdict through: the SDK reads init JSON
      // (server_ts, remote configs) and drops batches on a 400.
      const text = await res.text();
      reply.code(res.status).type('application/json');
      return text || '{}';
    } catch {
      // Collector down or slow: accept and drop — analytics never gets a
      // retry loop or an error surface in the game.
      reply.code(202);
      return {};
    }
  };

  app.post('/api/ga/v2/:key/events', { bodyLimit: MAX_BODY_BYTES }, async (req, reply) => {
    if (!limiter.allow(req.ip)) return reply.code(429).send({ error: 'rate_limited' });
    if (!env.GA_GAME_KEY || !env.GA_SECRET_KEY) return reply.code(202).send({});
    const events = req.body;
    const clean = Array.isArray(events)
      && events.length > 0 && events.length <= MAX_BATCH
      && events.every((e) => typeof e === 'object' && e !== null && !Array.isArray(e));
    if (!clean) return reply.code(400).send({ error: 'bad_batch' });
    return forward(reply, `/v2/${env.GA_GAME_KEY}/events`, JSON.stringify(events));
  });

  app.post('/api/ga/remote_configs/v1/init', { bodyLimit: MAX_BODY_BYTES }, async (req, reply) => {
    if (!limiter.allow(req.ip)) return reply.code(429).send({ error: 'rate_limited' });
    if (!env.GA_GAME_KEY || !env.GA_SECRET_KEY) return reply.code(202).send({});
    const annotations = req.body;
    if (typeof annotations !== 'object' || annotations === null || Array.isArray(annotations)) {
      return reply.code(400).send({ error: 'bad_init' });
    }
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries((req.query ?? {}) as Record<string, unknown>)) {
      if (typeof v === 'string') q.set(k, v);
    }
    q.set('game_key', env.GA_GAME_KEY); // the env key is authoritative, never the client's
    return forward(reply, `/remote_configs/v1/init?${q.toString()}`, JSON.stringify(annotations));
  });
}
