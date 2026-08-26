import { collectDefaultMetrics, Gauge, type Registry } from 'prom-client';
import type { Analytics } from './analytics.js';
import type { RoomStore } from './rooms.js';

/** Node runtime defaults plus live game gauges on the server's own registry,
 *  served at /metrics for an external scraper (e.g. Grafana Cloud). Monotonic
 *  counters and histograms are owned by Analytics on the same registry;
 *  gauges read fresh values at scrape time via collect(). */
export function registerGameMetrics(register: Registry, store: RoomStore, analytics: Analytics): void {
  collectDefaultMetrics({ register });
  new Gauge({
    name: 'ochre_rooms_open',
    help: 'Rooms currently held in memory, by phase',
    labelNames: ['phase'] as const,
    registers: [register],
    collect() {
      const s = store.stats();
      this.set({ phase: 'lobby' }, s.lobby);
      this.set({ phase: 'playing' }, s.playing);
      this.set({ phase: 'roundEnd' }, s.roundEnd);
    },
  });
  new Gauge({
    name: 'ochre_players_seated',
    help: 'Seats taken in open rooms',
    registers: [register],
    collect() { this.set(store.stats().seated); },
  });
  new Gauge({
    name: 'ochre_sockets_connected',
    help: 'Live socket.io connections',
    registers: [register],
    collect() { this.set(analytics.activeSessions()); },
  });
  // The journal in three readings. Depth says what the transactions cost in
  // memory and how close a single room comes to the cap; lag says whether the
  // acknowledgements are working at all — it sits at nothing while they are,
  // and climbs and stays up when they are not. Each takes its own pass rather
  // than sharing a cached one, so a single-metric scrape is never stale.
  new Gauge({
    name: 'ochre_history_transactions_stored',
    help: 'Journal transactions held in memory, summed over open rooms',
    registers: [register],
    collect() { this.set(store.journalStats().stored); },
  });
  new Gauge({
    name: 'ochre_history_transactions_deepest',
    help: 'Transactions in the deepest single room journal, against a cap of 200',
    registers: [register],
    collect() { this.set(store.journalStats().deepest); },
  });
  new Gauge({
    name: 'ochre_history_lag_transactions_max',
    help: 'Widest gap between a room journal head and a connected player pointer',
    registers: [register],
    collect() { this.set(store.journalStats().lagMax); },
  });
}
