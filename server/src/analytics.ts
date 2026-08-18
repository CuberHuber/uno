import type { FastifyBaseLogger } from 'fastify';
import { Counter, Histogram, type Registry } from 'prom-client';

const DAY_MS = 86_400_000;
const KEEP_DAYS = 8;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10); // UTC day

export interface StoreStats {
  rooms: number; lobby: number; playing: number; roundEnd: number;
  seated: number; connected: number;
}

export interface AnalyticsOptions {
  now?: () => number;
  log?: FastifyBaseLogger;
  register?: Registry;
}

/** First-party game analytics: aggregates since boot plus daily uniques,
 *  kept in memory like the rooms themselves. Long-term history lives in the
 *  structured log stream and (via the optional registry) in Prometheus. */
export class Analytics {
  private readonly now: () => number;
  private readonly log?: FastifyBaseLogger;
  readonly startedAtMs: number;

  private uniques = new Map<string, Set<string>>(); // UTC day -> anonymous visitor ids
  private sessions = new Map<string, number>(); // socket id -> connect time
  private roundStartedAtMs = new Map<string, number>(); // room code -> deal time

  private totals = {
    visits: 0, roomsCreated: 0, playersJoined: 0,
    roundsStarted: 0, roundsFinished: 0, roundSeats: 0,
    roundMs: 0, roundsTimed: 0,
    sessions: 0, sessionMs: 0,
  };

  private prom?: {
    visits: Counter; rooms: Counter; joins: Counter;
    roundsStarted: Counter; roundsFinished: Counter;
    roundSeconds: Histogram; sessionSeconds: Histogram;
  };

  constructor(opts: AnalyticsOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log;
    this.startedAtMs = this.now();
    if (opts.register) {
      const registers = [opts.register];
      this.prom = {
        visits: new Counter({ name: 'ochre_visits_total', help: 'Landing visits reported by the client beacon', registers }),
        rooms: new Counter({ name: 'ochre_rooms_created_total', help: 'Rooms created over HTTP', registers }),
        joins: new Counter({ name: 'ochre_players_joined_total', help: 'Seats taken (fresh joins, not resumes)', registers }),
        roundsStarted: new Counter({ name: 'ochre_rounds_started_total', help: 'Rounds dealt (first deal and rematches)', registers }),
        roundsFinished: new Counter({ name: 'ochre_rounds_finished_total', help: 'Rounds that reached a winner', registers }),
        roundSeconds: new Histogram({
          name: 'ochre_round_duration_seconds', help: 'Deal to win',
          buckets: [30, 60, 120, 300, 600, 1200, 2400], registers,
        }),
        sessionSeconds: new Histogram({
          name: 'ochre_session_duration_seconds', help: 'Socket connect to disconnect',
          buckets: [60, 300, 900, 1800, 3600, 7200], registers,
        }),
      };
    }
  }

  visit(vid: string): void {
    const day = dayOf(this.now());
    let ids = this.uniques.get(day);
    if (!ids) {
      ids = new Set();
      this.uniques.set(day, ids);
      for (const old of [...this.uniques.keys()].sort().slice(0, -KEEP_DAYS)) this.uniques.delete(old);
    }
    ids.add(vid);
    this.totals.visits += 1;
    this.prom?.visits.inc();
    this.log?.info({ evt: 'visit' }, 'visit');
  }

  sessionStarted(socketId: string): void {
    this.sessions.set(socketId, this.now());
  }

  sessionEnded(socketId: string): void {
    const startedAt = this.sessions.get(socketId);
    if (startedAt === undefined) return;
    this.sessions.delete(socketId);
    const ms = this.now() - startedAt;
    this.totals.sessions += 1;
    this.totals.sessionMs += ms;
    this.prom?.sessionSeconds.observe(ms / 1000);
    this.log?.info({ evt: 'session_ended', durationS: Math.round(ms / 1000) }, 'session ended');
  }

  roomCreated(code: string): void {
    this.totals.roomsCreated += 1;
    this.prom?.rooms.inc();
    this.log?.info({ evt: 'room_created', code }, 'room created');
  }

  playerJoined(code: string, seat: number): void {
    this.totals.playersJoined += 1;
    this.prom?.joins.inc();
    this.log?.info({ evt: 'player_joined', code, seat }, 'player joined');
  }

  roundStarted(code: string, seats: number): void {
    this.roundStartedAtMs.set(code, this.now());
    this.totals.roundsStarted += 1;
    this.totals.roundSeats += seats;
    this.prom?.roundsStarted.inc();
    this.log?.info({ evt: 'round_started', code, seats }, 'round started');
  }

  roundFinished(code: string, winnerSeat: number | null): void {
    const startedAt = this.roundStartedAtMs.get(code);
    this.roundStartedAtMs.delete(code);
    this.totals.roundsFinished += 1;
    this.prom?.roundsFinished.inc();
    let durationS: number | null = null;
    if (startedAt !== undefined) {
      const ms = this.now() - startedAt;
      this.totals.roundMs += ms;
      this.totals.roundsTimed += 1;
      this.prom?.roundSeconds.observe(ms / 1000);
      durationS = Math.round(ms / 1000);
    }
    this.log?.info({ evt: 'round_finished', code, winnerSeat, durationS }, 'round finished');
  }

  activeSessions(): number {
    return this.sessions.size;
  }

  summary(storeStats?: StoreStats) {
    const t = this.totals;
    const now = this.now();
    const avgMinutes = (ms: number, n: number) => (n === 0 ? null : Math.round(ms / n / 600) / 100);
    return {
      startedAt: new Date(this.startedAtMs).toISOString(),
      uptimeS: Math.round((now - this.startedAtMs) / 1000),
      players: {
        uniqueToday: this.uniques.get(dayOf(now))?.size ?? 0,
        uniqueYesterday: this.uniques.get(dayOf(now - DAY_MS))?.size ?? 0,
        connectedNow: this.sessions.size,
      },
      visits: t.visits,
      sessions: { count: t.sessions, avgMinutes: avgMinutes(t.sessionMs, t.sessions) },
      rooms: { created: t.roomsCreated, playersJoined: t.playersJoined },
      rounds: {
        started: t.roundsStarted,
        finished: t.roundsFinished,
        avgMinutes: avgMinutes(t.roundMs, t.roundsTimed),
        avgSeats: t.roundsStarted === 0 ? null : Math.round((t.roundSeats / t.roundsStarted) * 10) / 10,
      },
      now: storeStats ?? null,
    };
  }
}
