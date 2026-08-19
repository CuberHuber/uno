import { expect, test } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { Registry } from 'prom-client';
import { Analytics } from '../src/analytics.js';
import type { Visitor } from '../src/umami.js';

async function metric(register: Registry, name: string): Promise<number | null> {
  const text = await register.metrics();
  const m = text.match(new RegExp(`^${name} (\\d+(?:\\.\\d+)?)$`, 'm'));
  return m ? Number(m[1]) : null;
}

test('sessions land in the duration histogram', async () => {
  let now = 0;
  const register = new Registry();
  const a = new Analytics({ now: () => now, register });
  a.sessionStarted('s1');
  a.sessionStarted('s2');
  expect(a.activeSessions()).toBe(2);

  now = 60_000; a.sessionEnded('s1');
  now = 180_000; a.sessionEnded('s2');
  a.sessionEnded('ghost'); // unknown ids are ignored
  expect(a.activeSessions()).toBe(0);
  expect(await metric(register, 'ochre_session_duration_seconds_count')).toBe(2);
  expect(await metric(register, 'ochre_session_duration_seconds_sum')).toBe(240);
});

test('rooms and rounds feed the counters and round histogram', async () => {
  let now = 0;
  const register = new Registry();
  const a = new Analytics({ now: () => now, register });
  a.roomCreated('AAAAA');
  a.playerJoined('AAAAA', 0);
  a.playerJoined('AAAAA', 1);
  a.roundStarted('AAAAA', 2);
  now = 120_000; a.roundFinished('AAAAA', 0);
  a.roundFinished('CCCCC', null); // never saw the deal: counted, not timed

  expect(await metric(register, 'ochre_rooms_created_total')).toBe(1);
  expect(await metric(register, 'ochre_players_joined_total')).toBe(2);
  expect(await metric(register, 'ochre_rounds_started_total')).toBe(1);
  expect(await metric(register, 'ochre_rounds_finished_total')).toBe(2);
  expect(await metric(register, 'ochre_round_duration_seconds_count')).toBe(1);
  expect(await metric(register, 'ochre_round_duration_seconds_sum')).toBe(120);
});

test('runs registry-less as a pure log source', () => {
  const a = new Analytics({ now: () => 0 });
  a.roomCreated('AAAAA');
  a.sessionStarted('x');
  a.sessionEnded('x');
  a.roundStarted('AAAAA', 2);
  a.roundFinished('AAAAA', 1);
  a.joinFailed('AAAAA', 'wrong_pin');
  a.moveRejected('not_your_turn');
  a.rulesChanged('AAAAA', { stacking: true, forcePlay: false, drawToMatch: false, multiDiscard: false });
  a.rematchStarted('AAAAA');
  a.playerKicked('AAAAA', 2);
  expect(a.activeSessions()).toBe(0);
});

test('session_ended binds to room and seat once the socket had joined', () => {
  const lines: Record<string, unknown>[] = [];
  const log = {
    info: (o: object) => lines.push(o as Record<string, unknown>),
    debug: () => {}, warn: () => {}, error: () => {},
  } as unknown as FastifyBaseLogger;
  const a = new Analytics({ now: () => 0, log });

  a.sessionStarted('joined');
  a.sessionEnded('joined', { code: 'AAAAA', seat: 2 });
  expect(lines.find((l) => l.evt === 'session_ended')).toMatchObject({ code: 'AAAAA', seat: 2 });

  // Pre-join sockets still end cleanly with no seat reference.
  lines.length = 0;
  a.sessionStarted('drive-by');
  a.sessionEnded('drive-by');
  expect(lines.find((l) => l.evt === 'session_ended')).toMatchObject({ durationS: 0 });
});

test('server-truth events fan out to the Umami sender with the visitor', () => {
  const sent: [string, Record<string, unknown> | undefined, Visitor | undefined][] = [];
  const a = new Analytics({
    now: () => 0,
    sendEvent: async (name, data, visitor) => { sent.push([name, data, visitor]); },
  });
  const visitor = { ip: '203.0.113.7', userAgent: 'UA' }; // RFC 5737 doc address

  a.sessionStarted('s1', visitor);
  a.joinFailed('AAAAA', 'wrong_pin', visitor);
  a.roundStarted('AAAAA', 2, visitor);
  a.roundFinished('AAAAA', 0, visitor);
  a.sessionEnded('s1', { code: 'AAAAA', seat: 0 });

  expect(sent.map(([name]) => name)).toEqual(['join_failed', 'round_started', 'round_finished', 'session_ended']);
  expect(sent[0]![1]).toEqual({ reason: 'wrong_pin' });
  expect(sent[1]![1]).toEqual({ seats: 2 });
  expect(sent[2]![1]).toEqual({ durationS: 0 });
  for (const [, , v] of sent) expect(v).toBe(visitor); // session_ended reuses the stored visitor
  for (const [, data] of sent) expect(JSON.stringify(data ?? {})).not.toContain('AAAAA'); // no room codes leak
});

test('a rejecting sender never breaks a game path', () => {
  const a = new Analytics({
    now: () => 0,
    sendEvent: () => Promise.reject(new Error('umami down')),
  });
  expect(() => {
    a.joinFailed('AAAAA', 'no_such_room');
    a.roundStarted('AAAAA', 2);
    a.roundFinished('AAAAA', null);
  }).not.toThrow();
});

test('failed joins and rejected moves count by reason', async () => {
  const register = new Registry();
  const a = new Analytics({ now: () => 0, register });
  a.joinFailed('AAAAA', 'wrong_pin');
  a.joinFailed('AAAAA', 'wrong_pin');
  a.joinFailed('BBBBB', 'table_full');
  a.moveRejected('not_your_turn');
  const text = await register.metrics();
  expect(text).toMatch(/ochre_joins_failed_total\{reason="wrong_pin"\} 2/);
  expect(text).toMatch(/ochre_joins_failed_total\{reason="table_full"\} 1/);
  expect(text).toMatch(/ochre_moves_rejected_total\{reason="not_your_turn"\} 1/);
});
