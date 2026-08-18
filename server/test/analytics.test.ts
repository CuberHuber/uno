import { expect, test } from 'vitest';
import { Registry } from 'prom-client';
import { Analytics } from '../src/analytics.js';

test('daily uniques dedupe and roll over at UTC midnight', () => {
  let now = Date.UTC(2026, 7, 19, 12);
  const a = new Analytics({ now: () => now });
  a.visit('alice'); a.visit('alice'); a.visit('bob');
  expect(a.summary().players.uniqueToday).toBe(2);
  expect(a.summary().players.uniqueYesterday).toBe(0);

  now += 86_400_000; // next UTC day
  a.visit('alice');
  const s = a.summary();
  expect(s.players.uniqueToday).toBe(1);
  expect(s.players.uniqueYesterday).toBe(2);
  expect(s.visits).toBe(4);
});

test('sessions aggregate count and average duration', () => {
  let now = 0;
  const a = new Analytics({ now: () => now });
  a.sessionStarted('s1');
  a.sessionStarted('s2');
  expect(a.activeSessions()).toBe(2);

  now = 60_000; a.sessionEnded('s1');
  now = 180_000; a.sessionEnded('s2');
  a.sessionEnded('ghost'); // unknown ids are ignored
  expect(a.activeSessions()).toBe(0);
  expect(a.summary().sessions).toEqual({ count: 2, avgMinutes: 2 });
});

test('rounds aggregate durations and table sizes', () => {
  let now = 0;
  const a = new Analytics({ now: () => now });
  a.roomCreated('AAAAA');
  a.roundStarted('AAAAA', 2);
  now = 120_000; a.roundFinished('AAAAA', 0);
  a.roundStarted('BBBBB', 4);
  a.roundFinished('CCCCC', null); // never saw the deal: counted, not timed

  const s = a.summary();
  expect(s.rooms.created).toBe(1);
  expect(s.rounds.started).toBe(2);
  expect(s.rounds.finished).toBe(2);
  expect(s.rounds.avgMinutes).toBe(2); // only the timed round contributes
  expect(s.rounds.avgSeats).toBe(3);
});

test('prometheus counters track events when a registry is attached', async () => {
  const register = new Registry();
  const a = new Analytics({ now: () => 0, register });
  a.visit('visitor-aaaa-1111');
  a.roomCreated('AAAAA');
  a.roundStarted('AAAAA', 2);
  a.roundFinished('AAAAA', 0);
  const text = await register.metrics();
  expect(text).toContain('ochre_visits_total 1');
  expect(text).toContain('ochre_rooms_created_total 1');
  expect(text).toContain('ochre_rounds_started_total 1');
  expect(text).toContain('ochre_rounds_finished_total 1');
  expect(text).toContain('ochre_round_duration_seconds_count 1');
});
