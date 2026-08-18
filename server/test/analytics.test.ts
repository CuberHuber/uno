import { expect, test } from 'vitest';
import { Registry } from 'prom-client';
import { Analytics } from '../src/analytics.js';

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
  expect(a.activeSessions()).toBe(0);
});
