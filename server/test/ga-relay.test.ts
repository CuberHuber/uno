import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, expect, test } from 'vitest';
import { registerGaRelay } from '../src/ga-relay.js';
import { RateLimiter } from '../src/limiter.js';

// Placeholder credentials — never real ones (those live only in env).
const ENV = { GA_GAME_KEY: 'test-game-key', GA_SECRET_KEY: 'test-secret-key' };

const apps: { close(): Promise<void> }[] = [];
afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

async function build(opts: {
  env?: Record<string, string | undefined>;
  status?: number;
  reject?: boolean;
  limiter?: RateLimiter;
} = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    if (opts.reject) throw new Error('collector down');
    return new Response('{"x":1}', { status: opts.status ?? 200 });
  }) as typeof fetch;
  const app = Fastify();
  registerGaRelay(app, { env: opts.env ?? ENV, fetchFn, limiter: opts.limiter });
  await app.ready();
  apps.push(app);
  return { app, calls };
}

test('signs the forwarded batch with HMAC-SHA256 (base64) of the raw body', async () => {
  const { app, calls } = await build();
  const batch = [{ category: 'design', event_id: 'game:rematch' }];
  const res = await app.inject({ method: 'POST', url: '/api/ga/v2/browser-key/events', payload: batch });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ x: 1 });
  expect(calls).toHaveLength(1);
  // The env key is authoritative — the client's path segment is ignored.
  expect(calls[0]!.url).toBe('https://api.gameanalytics.com/v2/test-game-key/events');
  const body = calls[0]!.init.body as string;
  expect(JSON.parse(body)).toEqual(batch);
  const headers = calls[0]!.init.headers as Record<string, string>;
  expect(headers.authorization).toBe(
    createHmac('sha256', ENV.GA_SECRET_KEY).update(body).digest('base64'),
  );
});

test('relays remote-configs init, forcing the env game key into the query', async () => {
  const { app, calls } = await build();
  const annotations = { sdk_version: 'javascript 5.0.0', platform: 'browser' };
  const res = await app.inject({
    method: 'POST',
    url: '/api/ga/remote_configs/v1/init?game_key=browser-key&interval_seconds=0',
    payload: annotations,
  });

  expect(res.statusCode).toBe(200);
  const url = new URL(calls[0]!.url);
  expect(url.origin + url.pathname).toBe('https://api.gameanalytics.com/remote_configs/v1/init');
  expect(url.searchParams.get('game_key')).toBe('test-game-key');
  expect(url.searchParams.get('interval_seconds')).toBe('0');
  const body = calls[0]!.init.body as string;
  expect(JSON.parse(body)).toEqual(annotations);
  const headers = calls[0]!.init.headers as Record<string, string>;
  expect(headers.authorization).toBe(
    createHmac('sha256', ENV.GA_SECRET_KEY).update(body).digest('base64'),
  );
});

test('refuses bodies over 64 KB', async () => {
  const { app, calls } = await build();
  const res = await app.inject({
    method: 'POST',
    url: '/api/ga/v2/k/events',
    payload: [{ pad: 'x'.repeat(70 * 1024) }],
  });
  expect(res.statusCode).toBe(413);
  expect(calls).toHaveLength(0);
});

test('rejects a non-array batch and never forwards it', async () => {
  const { app, calls } = await build();
  const res = await app.inject({ method: 'POST', url: '/api/ga/v2/k/events', payload: { not: 'a batch' } });
  expect(res.statusCode).toBe(400);
  expect(calls).toHaveLength(0);
});

test('answers 202 and stays up when the collector is unreachable', async () => {
  const { app, calls } = await build({ reject: true });
  const res = await app.inject({ method: 'POST', url: '/api/ga/v2/k/events', payload: [{ category: 'design' }] });
  expect(res.statusCode).toBe(202);
  expect(calls).toHaveLength(1); // it tried, failed, and swallowed the failure
});

test('is a silent 202 when the relay env is missing', async () => {
  const { app, calls } = await build({ env: {} });
  const res = await app.inject({ method: 'POST', url: '/api/ga/v2/k/events', payload: [{ category: 'design' }] });
  expect(res.statusCode).toBe(202);
  expect(calls).toHaveLength(0);
});

test('rate limits per IP', async () => {
  const { app } = await build({ limiter: new RateLimiter(2, 60_000) });
  const post = () => app.inject({ method: 'POST', url: '/api/ga/v2/k/events', payload: [{ category: 'design' }] });
  expect((await post()).statusCode).toBe(200);
  expect((await post()).statusCode).toBe(200);
  expect((await post()).statusCode).toBe(429);
});
