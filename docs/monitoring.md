# Monitoring & analytics runbook

Everything the game measures about itself,
  and where to look at it.
Dashboards live in external services on purpose —
  the app itself serves no admin pages.
The research behind these choices lives in the
  "Ochre Eights Observability" report artifact.

## Where to look

| Question | Service |
|---|---|
| Who plays, from where, how many uniques? | Umami (cloud.umami.is) |
| Game KPIs: sessions, retention, playtime, event funnels | GameAnalytics (gameanalytics.com) |
| Server health: event-loop lag, memory, rooms, round durations | Fly Grafana (fly-metrics.net) |
| Is it down? | Any uptime pinger on `/healthz` |
| What happened at 14:03? | `fly logs` (structured JSON events) |

## What the server exposes

Machine endpoints only — nothing here is meant for a browser:

- `GET /healthz` —
  `{ ok, uptimeS, rooms, lobby, playing, roundEnd, seated, connected }`
  for uptime pingers.
- `GET /metrics` — Prometheus text (Node defaults + `ochre_*` series),
  scraped by Fly via the `[metrics]` block in `fly.toml`,
  graphed at <https://fly-metrics.net>.

Custom series:
  `ochre_rooms_open{phase=…}`, `ochre_players_seated`, `ochre_sockets_connected`
  (gauges);
  `ochre_rooms_created_total`, `ochre_players_joined_total`,
  `ochre_rounds_started_total`, `ochre_rounds_finished_total`
  (counters — use `increase()`);
  `ochre_round_duration_seconds`, `ochre_session_duration_seconds`
  (histograms — use `histogram_quantile()`).
Watch `nodejs_eventloop_lag_seconds` and `process_resident_memory_bytes`:
  on a 256 MB machine those two predict trouble first.

## External analytics (client-side)

`client/src/analytics.ts` boots whichever services are configured
  at build time and is a silent no-op otherwise.
Configuration is via Vite env vars — see `client/.env.example`;
  locally put them in `client/.env`,
  in production pass them as Docker build args:

```sh
fly deploy \
  --build-arg VITE_UMAMI_WEBSITE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
  --build-arg VITE_GA_GAME_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  --build-arg VITE_GA_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- **Umami** (open-source, cookie-less, no consent banner):
  counts pageviews, visitors, and the custom events below.
  Free cloud tier: 100K events/month.
  Self-hosters can point `VITE_UMAMI_SRC` at their own `script.js`.
- **GameAnalytics** (free, built for games):
  tracks sessions/retention/playtime automatically once initialized,
  and receives the game events as design events (`game:room_created`, …).
  Both keys are client-side by design — they ship in the JS bundle.

Events sent to both services:
  `room_created`, `room_joined` (fresh seats only, resumes excluded),
  `round_started`, `round_finished` (with `won: true/false` in Umami).
A reconnect mid-round re-reports `round_started`;
  treat that series as approximate.

## Server-side telemetry

Fastify's built-in pino logger is enabled by the entrypoint,
  with room PINs, seat tokens, and auth headers redacted.
Game events are structured lines:
  `evt` is one of `room_created`, `player_joined`,
  `round_started`, `round_finished`, `session_ended`.
Per-request HTTP logging is deliberately off — the game lives on websockets.
Read them with `fly logs`; they are also the durable history,
  since Prometheus counters reset on deploy.

Env vars: `LOG_LEVEL` (default `info`),
  `NODE_ENV=production` for JSON output (the Dockerfile sets it),
  `RATE_LIMITS=off` for local load tests only.

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
Baselines from 2026-08-19 on the dev machine:
  911 rounds/12 s on 5 tables, 4 422 actions/s, p95 lag 0.5 ms;
  `/healthz` at 41 k req/s.

## Flamegraphs

```sh
RATE_LIMITS=off PORT=3100 npm run flame -w server
```

That builds and runs the server under `0x`;
  drive load with `bench:ws`, then Ctrl-C to open the interactive flamegraph.
Capture dirs (`*.0x/`) are gitignored.
For async-stall hunting, `npx clinic doctor -- node server/dist/server.js`
  is the next tool up; profile locally, never on the prod machine.
