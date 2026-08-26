import type { FastifyBaseLogger } from 'fastify';
import { Counter, Histogram, type Registry } from 'prom-client';
import type { Rules } from '@uno/shared';
import type { UmamiSender, Visitor } from './umami.js';

export interface AnalyticsOptions {
  now?: () => number;
  log?: FastifyBaseLogger;
  register?: Registry;
  sendEvent?: UmamiSender;
}

/** How a return to a table was answered: the gap was closed by a delta, there
 *  was no gap, the gap reached further back than the journal keeps, or the
 *  journal could not answer at all. Four words, and never a fifth — a label is
 *  only ever drawn from a dictionary this small. */
export type CatchUpOutcome = 'delta' | 'empty' | 'truncated' | 'failed';

/** What a turn queue must never be found doing. Not a statistic: this series
 *  exists in order to read zero, and any other reading is an incident. */
export type TurnAnomaly = 'turn_out_of_range' | 'turn_on_removed' | 'no_seats_left';

/** The codes `wire.ts` can refuse a frame with. Written down here because a
 *  parser answers with `error: string`, and a label taken from a `string` is one
 *  careless call site away from unbounded cardinality: anything not on this list
 *  counts as `other` instead of opening a series of its own. */
const WIRE_REASONS: ReadonlySet<string> = new Set([
  'bad_request', 'table_not_found', 'bad_pin', 'bad_stack', 'wild_needs_color', 'no_such_seat',
]);

/** Game telemetry with no in-app dashboard: every lifecycle event becomes a
 *  structured log line and, when a registry is attached, a Prometheus series
 *  at /metrics. Humans watch external dashboards only — the hosting panel and
 *  Grafana Cloud for server health, Umami/GameAnalytics for player behaviour. */
export class Analytics {
  private readonly now: () => number;
  private readonly log?: FastifyBaseLogger;
  private readonly sendEvent?: UmamiSender;

  private sessions = new Map<string, { startedAt: number; visitor?: Visitor }>(); // by socket id
  private roundStartedAtMs = new Map<string, number>(); // room code -> deal time

  private prom?: {
    rooms: Counter; joins: Counter;
    joinsFailed: Counter<'reason'>; movesRejected: Counter<'reason'>;
    wireRejected: Counter<'reason'>; actionBudget: Counter;
    roundsStarted: Counter; roundsFinished: Counter;
    roundSeconds: Histogram; sessionSeconds: Histogram;
    catchUps: Counter<'outcome'>; catchUpGap: Histogram;
    turnAnomalies: Counter<'kind'>;
  };

  constructor(opts: AnalyticsOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log;
    this.sendEvent = opts.sendEvent;
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
          name: 'ochre_moves_rejected_total', help: 'Game actions the rules turned down, by reason',
          labelNames: ['reason'] as const, registers,
        }),
        wireRejected: new Counter({
          name: 'ochre_wire_frames_rejected_total',
          help: 'Frames refused at the protocol boundary before any game rule was read, by reason',
          labelNames: ['reason'] as const, registers,
        }),
        actionBudget: new Counter({
          name: 'ochre_action_budget_exceeded_total',
          help: 'Actions turned away by the per-socket action budget', registers,
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
        catchUps: new Counter({
          name: 'ochre_catchups_served_total',
          help: 'Returns to a table, by what the journal could do about the gap',
          labelNames: ['outcome'] as const, registers,
        }),
        // Transactions, not seconds: this measures a distance in the journal.
        // The buckets straddle MAX_TRANSACTIONS on purpose — the share above
        // le=200 is how often the cap is what turned a return into a reset.
        catchUpGap: new Histogram({
          name: 'ochre_catchup_gap_transactions',
          help: 'How far behind a returning player was, in journal transactions',
          buckets: [0, 1, 2, 5, 10, 25, 50, 100, 200, 400, 800], registers,
        }),
        turnAnomalies: new Counter({
          name: 'ochre_turn_queue_anomalies_total',
          help: 'Turn-queue invariants found broken after an accepted action — always zero on a healthy server',
          labelNames: ['kind'] as const, registers,
        }),
      };
    }
  }

  /** Fan a server-truth event out to Umami. The sender is fail-safe by
   *  contract, but game paths must survive even a misbehaving one. */
  private emit(name: string, data?: Record<string, unknown>, visitor?: Visitor): void {
    try {
      void Promise.resolve(this.sendEvent?.(name, data, visitor)).catch(() => {});
    } catch {
      // Telemetry must never break the game.
    }
  }

  sessionStarted(socketId: string, visitor?: Visitor): void {
    this.sessions.set(socketId, { startedAt: this.now(), visitor });
  }

  /** `at` binds the session to its table once the socket has joined one;
   *  pre-join sockets pass nothing and the log line simply has no code/seat. */
  sessionEnded(socketId: string, at?: { code: string; seat: number }): void {
    const session = this.sessions.get(socketId);
    if (session === undefined) return;
    this.sessions.delete(socketId);
    const ms = this.now() - session.startedAt;
    const durationS = Math.round(ms / 1000);
    this.prom?.sessionSeconds.observe(ms / 1000);
    this.log?.info({ evt: 'session_ended', durationS, code: at?.code, seat: at?.seat }, 'session ended');
    this.emit('session_ended', { durationS }, session.visitor);
  }

  roomCreated(code: string): void {
    this.prom?.rooms.inc();
    this.log?.info({ evt: 'room_created', code }, 'room created');
  }

  playerJoined(code: string, seat: number): void {
    this.prom?.joins.inc();
    this.log?.info({ evt: 'player_joined', code, seat }, 'player joined');
  }

  roundStarted(code: string, seats: number, visitor?: Visitor): void {
    this.roundStartedAtMs.set(code, this.now());
    this.prom?.roundsStarted.inc();
    this.log?.info({ evt: 'round_started', code, seats }, 'round started');
    // Umami event data carries no room codes — only sizes and durations.
    this.emit('round_started', { seats }, visitor);
  }

  roundFinished(code: string, winnerSeat: number | null, visitor?: Visitor): void {
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
    this.emit('round_finished', durationS === null ? {} : { durationS }, visitor);
  }

  /** The entry funnel's dark side: wrong codes, PINs, full tables, limits.
   *  Was previously counted nowhere — not in logs, not in metrics. */
  joinFailed(code: string, reason: string, visitor?: Visitor): void {
    this.prom?.joinsFailed.inc({ reason });
    this.log?.info({ evt: 'join_failed', code, reason }, 'join failed');
    this.emit('join_failed', { reason }, visitor);
  }

  /** Rejected moves are frequent and benign (misclicks), so they count in
   *  Prometheus but log at debug to keep the info stream readable.
   *
   *  Rules only. "You cannot play that" and "that is not a protocol frame" are
   *  different failures read by different people — see `wireRejected`. */
  moveRejected(reason: string): void {
    this.prom?.movesRejected.inc({ reason });
    this.log?.debug({ evt: 'move_rejected', reason }, 'move rejected');
  }

  /** A frame that never reached a rule: `wire.ts` refused its shape. A real
   *  client cannot produce one — its own UI can only send well-formed frames —
   *  so a rate here is either a client bug or somebody prodding the socket, and
   *  it is worth reading apart from the misclicks in `moveRejected`. */
  wireRejected(reason: string): void {
    this.prom?.wireRejected.inc({ reason: WIRE_REASONS.has(reason) ? reason : 'other' });
    this.log?.debug({ evt: 'wire_rejected', reason }, 'frame refused at the wire');
  }

  /** The per-socket action budget saying no. A human at a table never reaches
   *  it — twenty frames a seat a round against a hundred and twenty in ten
   *  seconds — so anything but a flat zero means the ceiling is too low or the
   *  socket is not a human. Counted apart from the moves for that reason. */
  actionBudgetExceeded(): void {
    this.prom?.actionBudget.inc();
    this.log?.debug({ evt: 'action_budget_exceeded' }, 'action budget exceeded');
  }

  /** A player came back and the journal answered. `gap` is a count of
   *  transactions — how much had happened while they were away — and `null`
   *  when the journal could not say. Nothing here identifies anybody: the
   *  outcome is one of four words and the gap is a distance. */
  catchUpServed(outcome: CatchUpOutcome, gap: number | null, visitor?: Visitor): void {
    this.prom?.catchUps.inc({ outcome });
    if (gap !== null && Number.isFinite(gap) && gap >= 0) this.prom?.catchUpGap.observe(gap);
    this.log?.debug({ evt: 'catch_up', outcome, gap }, 'catch-up served');
    this.emit('catch_up', { outcome }, visitor);
  }

  /** The turn queue caught in a state it promises never to be in. An incident,
   *  not a rate: it logs at error with the room code so the table can be found,
   *  and the label carries only which invariant broke. */
  turnAnomaly(kind: TurnAnomaly, code?: string): void {
    this.prom?.turnAnomalies.inc({ kind });
    this.log?.error({ evt: 'turn_queue_anomaly', kind, code }, 'turn queue anomaly');
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

  /** Rooms die silently in the sweep; a room swept mid-round would otherwise
   *  leave its deal timestamp in the Map forever. Routine housekeeping, so it
   *  logs at debug like moveRejected. */
  roomClosed(code: string): void {
    const droppedOpenRound = this.roundStartedAtMs.delete(code);
    this.log?.debug({ evt: 'room_closed', code, droppedOpenRound }, 'room closed');
  }

  /** Read-only seam (like activeSessions) so tests can prove swept rooms leak nothing. */
  hasOpenRound(code: string): boolean {
    return this.roundStartedAtMs.has(code);
  }

  activeSessions(): number {
    return this.sessions.size;
  }
}
