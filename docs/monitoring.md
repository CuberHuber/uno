# Monitoring & analytics runbook

Everything the game measures about itself,
  and every dial you can look at.
The full research behind these choices lives in the
  "Ochre Eights Observability" report artifact.

## What the server exposes

| Endpoint | What | Guard |
|---|---|---|
| `GET /healthz` | `{ ok, uptimeS, rooms, lobby, playing, roundEnd, seated, connected }` | none |
| `GET /metrics` | Prometheus text: Node defaults + `ochre_*` game series | none (safe: counts only) |
| `POST /api/analytics/event` | visit beacon `{ type: "visit", vid }` | 60/min per IP |
| `GET /api/admin/stats` | JSON summary: uniques, sessions, rooms, rounds | `Authorization: Bearer $ADMIN_TOKEN`; 404 while unset |
| `GET /admin` | auto-refreshing dashboard over the stats endpoint | token pasted once, kept in localStorage |

## Environment variables

- `ADMIN_TOKEN` — enables `/api/admin/stats` and the `/admin` panel.
  Set it as a Fly secret: `fly secrets set ADMIN_TOKEN=$(openssl rand -hex 16)`.
- `LOG_LEVEL` — pino level, default `info`.
- `NODE_ENV=production` — JSON logs (the Dockerfile sets it);
  anything else gets pino-pretty output for `npm run dev -w server`.
- `RATE_LIMITS=off` — removes the per-IP limits so load tests can run.
  Local benchmarking only; never set it in production.

## Logs

Fastify's built-in pino logger is enabled by the entrypoint,
  with room PINs, seat tokens, and auth headers redacted.
Game events are structured lines:
  `evt` is one of `visit`, `room_created`, `player_joined`,
  `round_started`, `round_finished`, `session_ended`.
Per-request HTTP logging is deliberately off — the game lives on websockets.

In production read them with `fly logs` (live) or the Fly dashboard.
Because aggregates reset on deploy, the log stream is also the durable
  history: every counted event has a line.

## Metrics

`fly.toml` carries a `[metrics]` block, so Fly scrapes `/metrics`
  automatically and stores it in its managed Prometheus.
Dashboards live at <https://fly-metrics.net> (sign in with the Fly account);
  the built-in ones cover VM CPU/memory/network already.
Custom series to graph:

- `ochre_rooms_open{phase=…}`, `ochre_players_seated`, `ochre_sockets_connected` — live gauges.
- `ochre_visits_total`, `ochre_rooms_created_total`, `ochre_players_joined_total`,
  `ochre_rounds_started_total`, `ochre_rounds_finished_total` — counters, use `increase()`.
- `ochre_round_duration_seconds`, `ochre_session_duration_seconds` — histograms,
  use `histogram_quantile()`.
- Watch `nodejs_eventloop_lag_seconds` and `process_resident_memory_bytes` —
  on a 256 MB machine those two predict trouble first.

## Benchmarks

Start a server to test against
  (barista runs the dev server themselves; for load tests use a throwaway port):

```sh
npm run build
RATE_LIMITS=off PORT=3100 npm start -w server
```

Then, in another terminal:

```sh
BASE_URL=http://127.0.0.1:3100 npm run bench:http   # autocannon: req/s + latency percentiles
BASE_URL=http://127.0.0.1:3100 npm run bench:ws     # bot swarm playing real rounds
```

`bench:ws` knobs: `TABLES` (default 10), `SEATS` (2–4, default 2),
  `DURATION` seconds (default 30).
It reports rounds finished, actions/s, rejects,
  and action→broadcast latency percentiles.
Record the numbers in the PR when performance-sensitive changes land.

## Flamegraphs

```sh
RATE_LIMITS=off PORT=3100 npm run flame -w server
```

That builds and runs the server under `0x`;
  drive load with `bench:ws`, then Ctrl-C to open the interactive flamegraph.
Capture dirs (`*.0x/`) are gitignored.
For async-stall hunting, `npx clinic doctor -- node server/dist/server.js`
  is the next tool up; profile locally, never on the prod machine.

## Player analytics

The client sends one anonymous visit beacon per page load
  (`oe:vid` in localStorage — a random UUID, no cookies, no fingerprinting).
The server aggregates daily uniques (UTC days), session lengths,
  rooms, and rounds in memory; see `/admin`.
If funnels or retention cohorts become interesting,
  the researched next step is PostHog Cloud's free tier
  (1M events/mo, EU region available) wired into the client;
  Umami Cloud is the lighter traffic-only alternative.
