import Fastify from 'fastify';
import { expect, test } from 'vitest';
import { buildServer, routeErrorHandler } from '../src/server.js';
import { RoomStore } from '../src/rooms.js';

test('a thrown route error logs the stack and returns an opaque 500', async () => {
  const lines: Record<string, unknown>[] = [];
  const app = Fastify({
    logger: { level: 'info', stream: { write: (line: string) => { lines.push(JSON.parse(line)); } } },
  });
  app.setErrorHandler(routeErrorHandler);
  app.get('/boom', async () => {
    throw new Error('secret table detail');
  });

  const res = await app.inject({ method: 'GET', url: '/boom' });
  expect(res.statusCode).toBe(500);
  expect(res.json()).toEqual({ error: 'internal_error' });
  expect(res.body).not.toContain('secret table detail'); // no message, no stack on the wire

  const logged = lines.find((l) => l.msg === 'unhandled route error') as
    { err: { message: string; stack: string }; url: string } | undefined;
  expect(logged).toBeDefined();
  expect(logged!.url).toBe('/boom');
  expect(logged!.err.message).toBe('secret table detail');
  expect(logged!.err.stack).toContain('error-handler.test.ts'); // real stack reached the log
  await app.close();
});

test('parser-level 4xx keeps its status but sheds the internals', async () => {
  // Through the real buildServer, proving the handler is wired in.
  const { app } = await buildServer(new RoomStore());
  const res = await app.inject({
    method: 'POST',
    url: '/api/ga/v2/k/events',
    headers: { 'content-type': 'application/json' },
    payload: '{broken json',
  });
  expect(res.statusCode).toBe(400);
  expect(res.body).not.toContain('SyntaxError');
  expect(res.body).not.toContain('Unexpected');
  expect(typeof res.json().error).toBe('string');
  await app.close();
});
