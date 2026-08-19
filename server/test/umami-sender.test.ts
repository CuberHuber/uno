import { expect, test } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { createUmamiSender } from '../src/umami.js';

// 203.0.113.0/24 is TEST-NET-3 (RFC 5737) — documentation addresses only.
const VISITOR = { ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (test browser)' };

function fetchStub(status = 200, reject = false) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    if (reject) throw new Error('connect refused');
    return new Response('{}', { status });
  }) as typeof fetch;
  return { calls, fn };
}

function warnSpy() {
  const warns: unknown[] = [];
  const log = { warn: (o: unknown) => warns.push(o) } as unknown as FastifyBaseLogger;
  return { warns, log };
}

test('stays a silent no-op while env is missing', async () => {
  const { calls, fn } = fetchStub();
  const missingId = createUmamiSender({ env: { UMAMI_HOST: 'https://stats.example.test' }, fetchFn: fn });
  const missingHost = createUmamiSender({ env: { UMAMI_WEBSITE_ID: 'site-1' }, fetchFn: fn });
  await missingId('round_started');
  await missingHost('round_started');
  expect(calls).toHaveLength(0);
});

test('posts the v2.17 event payload with ip/userAgent overrides', async () => {
  const { calls, fn } = fetchStub();
  const send = createUmamiSender({
    env: { UMAMI_WEBSITE_ID: 'site-1', UMAMI_HOST: 'https://stats.example.test' },
    fetchFn: fn,
  });
  await send('round_started', { seats: 2 }, VISITOR);

  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe('https://stats.example.test/api/send');
  const headers = calls[0]!.init.headers as Record<string, string>;
  expect(headers['user-agent']).toBe(VISITOR.userAgent);
  expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
    type: 'event',
    payload: {
      website: 'site-1',
      url: '/srv',
      name: 'round_started',
      data: { seats: 2 },
      ip: VISITOR.ip,
      userAgent: VISITOR.userAgent,
    },
  });
});

test('derives the endpoint from UMAMI_SRC when UMAMI_HOST is unset', async () => {
  const { calls, fn } = fetchStub();
  const send = createUmamiSender({
    env: { UMAMI_WEBSITE_ID: 'site-1', UMAMI_SRC: 'https://stats.example.test/script.js' },
    fetchFn: fn,
  });
  await send('session_ended');
  expect(calls[0]!.url).toBe('https://stats.example.test/api/send');
  // Pre-join sockets have no visitor: no overrides, but a valid UA header.
  const headers = calls[0]!.init.headers as Record<string, string>;
  expect(headers['user-agent']).toBeTruthy();
  const { payload } = JSON.parse(calls[0]!.init.body as string);
  expect(payload).not.toHaveProperty('ip');
  expect(payload).not.toHaveProperty('userAgent');
});

test('never throws on HTTP failure and warns at most once a minute', async () => {
  const { fn } = fetchStub(500);
  const { warns, log } = warnSpy();
  let now = 0;
  const send = createUmamiSender({
    env: { UMAMI_WEBSITE_ID: 'site-1', UMAMI_HOST: 'https://stats.example.test' },
    fetchFn: fn, log, now: () => now,
  });
  await send('a');
  await send('b'); // within the mute window: swallowed
  expect(warns).toHaveLength(1);
  now = 61_000;
  await send('c');
  expect(warns).toHaveLength(2);
});

test('never throws when fetch itself rejects', async () => {
  const { fn } = fetchStub(200, true);
  const { warns, log } = warnSpy();
  const send = createUmamiSender({
    env: { UMAMI_WEBSITE_ID: 'site-1', UMAMI_HOST: 'https://stats.example.test' },
    fetchFn: fn, log,
  });
  await expect(send('round_finished', { durationS: 60 }, VISITOR)).resolves.toBeUndefined();
  expect(warns).toHaveLength(1);
});
