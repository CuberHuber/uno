import type { FastifyBaseLogger } from 'fastify';
import { Counter, Histogram, type Registry } from 'prom-client';
import type { Rules } from '@uno/shared';

export interface AnalyticsOptions {
  now?: () => number;
  log?: FastifyBaseLogger;
  register?: Registry;
}

/** Game telemetry with no in-app dashboard: every lifecycle event becomes a
 *  structured log line and, when a registry is attached, a Prometheus series
 *  at /metrics. Humans watch external dashboards only — the hosting panel and
 *  Grafana Cloud for server health, Umami/GameAnalytics for player behaviour. */
export class Analytics {
  private readonly now: () => number;
  private readonly log?: FastifyBaseLogger;

  private sessions = new Map<string, number>(); // socket id -> connect time
  private roundStartedAtMs = new Map<string, number>(); // room code -> deal time

  private prom?: {
    rooms: Counter; joins: Counter;
    joinsFailed: Counter<'reason'>; movesRejected: Counter<'reason'>;
    roundsStarted: Counter; roundsFinished: Counter;
    roundSeconds: Histogram; sessionSeconds: Histogram;
  };

  constructor(opts: AnalyticsOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log;
    if (opts.register) {
      const registers = [opts.register];
      this.prom = {
        rooms: new Counter({ name: 'ochre_rooms_created_total', help: 'Rooms created over HTTP', registers }),
        joins: new Counter({ name: 'ochre_players_joined_total', help: 'Seats taken (fresh joins, not resumes)', registers }),
        joinsFailed: new Counter({
          name: 'ochre_joins_failed_total', help: 'Join attempts the server turned away, by reason',
          labelNames: ['reason'] as const, registers,
        }),
        movesRejected: new Counter({
          name: 'ochre_moves_rejected_total', help: 'Game actions the engine rejected, by reason',
          labelNames: ['reason'] as const, registers,
        }),
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

  sessionStarted(socketId: string): void {
    this.sessions.set(socketId, this.now());
  }

  sessionEnded(socketId: string): void {
    const startedAt = this.sessions.get(socketId);
    if (startedAt === undefined) return;
    this.sessions.delete(socketId);
    const ms = this.now() - startedAt;
    this.prom?.sessionSeconds.observe(ms / 1000);
    this.log?.info({ evt: 'session_ended', durationS: Math.round(ms / 1000) }, 'session ended');
  }

  roomCreated(code: string): void {
    this.prom?.rooms.inc();
    this.log?.info({ evt: 'room_created', code }, 'room created');
  }

  playerJoined(code: string, seat: number): void {
    this.prom?.joins.inc();
    this.log?.info({ evt: 'player_joined', code, seat }, 'player joined');
  }

  roundStarted(code: string, seats: number): void {
    this.roundStartedAtMs.set(code, this.now());
    this.prom?.roundsStarted.inc();
    this.log?.info({ evt: 'round_started', code, seats }, 'round started');
  }

  roundFinished(code: string, winnerSeat: number | null): void {
    const startedAt = this.roundStartedAtMs.get(code);
    this.roundStartedAtMs.delete(code);
    this.prom?.roundsFinished.inc();
    let durationS: number | null = null;
    if (startedAt !== undefined) {
      const ms = this.now() - startedAt;
      this.prom?.roundSeconds.observe(ms / 1000);
      durationS = Math.round(ms / 1000);
    }
    this.log?.info({ evt: 'round_finished', code, winnerSeat, durationS }, 'round finished');
  }

  /** The entry funnel's dark side: wrong codes, PINs, full tables, limits.
   *  Was previously counted nowhere — not in logs, not in metrics. */
  joinFailed(code: string, reason: string): void {
    this.prom?.joinsFailed.inc({ reason });
    this.log?.info({ evt: 'join_failed', code, reason }, 'join failed');
  }

  /** Rejected moves are frequent and benign (misclicks), so they count in
   *  Prometheus but log at debug to keep the info stream readable. */
  moveRejected(reason: string): void {
    this.prom?.movesRejected.inc({ reason });
    this.log?.debug({ evt: 'move_rejected', reason }, 'move rejected');
  }

  rulesChanged(code: string, rules: Rules): void {
    this.log?.info({ evt: 'rules_changed', code, rules }, 'rules changed');
  }

  rematchStarted(code: string): void {
    this.log?.info({ evt: 'rematch_started', code }, 'rematch started');
  }

  playerKicked(code: string, seat: number): void {
    this.log?.info({ evt: 'player_kicked', code, seat }, 'player kicked after grace');
  }

  activeSessions(): number {
    return this.sessions.size;
  }
}
