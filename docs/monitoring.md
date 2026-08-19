# Monitoring & analytics runbook

Everything the game measures about itself,
  and where to look at it.
Dashboards live in external services on purpose —
  the app itself serves no admin pages.
The game runs on Timeweb App Platform
  (Dockerfile build, auto-deploy on push to `main`).
Real identifiers — the app domain, Umami website ID, analytics keys —
  live only in the panel's env vars, never in tracked files;
  `<app-domain>` below stands for the deployed hostname.
The research behind these choices lives in the
  "Ochre Eights Observability" report artifact.

## Where to look

| Question | Service |
|---|---|
| Who plays, from where, how many uniques? | Umami (cloud.umami.is) |
| Game KPIs: sessions, retention, playtime, event funnels | GameAnalytics (go.gameanalytics.com) |
| CPU / RAM / disk / network of the app | Timeweb panel → app → Мониторинг |
| Game-level server metrics (rooms, rounds, lag) | Grafana Cloud scraping `/metrics` (optional) |
| Is it down? | Any uptime pinger on `/healthz` |
| What happened at 14:03? | Timeweb panel → app → Логи (structured JSON) |

## What the server exposes

Machine endpoints only — nothing here is meant for a browser:

- `GET /healthz` —
  `{ ok, uptimeS, rooms, lobby, playing, roundEnd, seated, connected }`.
  Point external uptime pingers here,
  and set it as the app's health-check path in the Timeweb panel.
- `GET /metrics` — Prometheus text (Node defaults + `ochre_*` series).
  Timeweb does not scrape custom metrics;
  to get dashboards, add a free Grafana Cloud account and create a
  "Metrics Endpoint" scrape job pointing at
  `https://<app-domain>/metrics`
  (agentless, scrapes every 60 s, free tier holds 10k series).
  Step-by-step scrape setup and the three alert rules:
  [ops/grafana-cloud.md](ops/grafana-cloud.md).
- `GET /config.js` — runtime analytics keys for the client,
  generated from the server's env vars (see below). Not secret.

Custom series:
  `ochre_rooms_open{phase=…}`, `ochre_players_seated`, `ochre_sockets_connected`
  (gauges);
  `ochre_rooms_created_total`, `ochre_players_joined_total`,
  `ochre_rounds_started_total`, `ochre_rounds_finished_total`
  (counters — use `increase()`);
  `ochre_round_duration_seconds`, `ochre_session_duration_seconds`
  (histograms — use `histogram_quantile()`).
Watch `nodejs_eventloop_lag_seconds` and `process_resident_memory_bytes` —
  the earliest trouble signals on a 1 CPU / 1 GB app.

## External analytics (client-side)

`client/src/analytics.ts` boots whichever services are configured
  and is a silent no-op otherwise.
Configuration is runtime-first:
  the server env vars below are served to the client via `GET /config.js`,
  so setting them in the Timeweb panel (app → переменные окружения)
  and restarting the app is enough — no rebuild.

| Server env var (Timeweb panel) | Meaning |
|---|---|
| `UMAMI_WEBSITE_ID` | Umami website ID from cloud.umami.is |
| `UMAMI_SRC` | Only for self-hosted Umami; defaults to the cloud script |
| `UMAMI_HOST` | Origin for server-side `POST /api/send` (e.g. `https://<UMAMI_HOST>`); falls back to the origin of `UMAMI_SRC` |
| `UMAMI_DOMAINS` | Comma-separated hostnames Umami records (keeps localhost/preview noise out) |
| `GA_GAME_KEY` | GameAnalytics game key, served to the client |
| `GA_SECRET_KEY` | GameAnalytics secret — server-side only, never served; the browser SDK posts through `POST /api/ga/*` and the relay re-signs |

For local dev without the backend, `client/.env` (see `client/.env.example`)
  provides the same values at build time as a fallback.

- **Umami** (open-source, cookie-less, no consent banner):
  pageviews, visitors, and the custom events below.
  Set `UMAMI_WEBSITE_ID` (and `UMAMI_DOMAINS` with the prod hostnames)
  in the panel; the tracking script only loads when the ID is present.
  Free cloud tier: 100K events/month.
  Self-hosted installs need the yearly data cleanup cron:
  [ops/umami-cleanup.md](ops/umami-cleanup.md).
- **GameAnalytics** (free, built for games):
  sessions/retention/playtime automatically once initialized,
  plus the game events as design events (`game:room_created`, …).
  The SDK loads as its own lazy chunk only when keys are present.
  Account/keys walkthrough: [gameanalytics-setup.md](gameanalytics-setup.md).

Events sent to both services:
  `room_created`, `room_joined` (fresh seats only, resumes excluded),
  `round_started`, `round_finished` (with `won: true/false` in Umami).
A reconnect mid-round re-reports `round_started`;
  treat that series as approximate.

## Server-side telemetry

Fastify's built-in pino logger is enabled by the entrypoint,
  with room PINs, seat tokens, and auth headers redacted.
Game events are structured lines:
  `evt` is one of `room_created`, `player_joined`, `join_failed`,
  `round_started`, `round_finished`, `session_ended`
  (plus `rules_changed`, `rematch_started`, `player_kicked`, `move_rejected`).
`session_ended` carries `code` and `seat` once the socket had joined a table.
Per-request HTTP logging is deliberately off — the game lives on websockets.
Uncaught route errors are logged with their stack;
  the HTTP response is an opaque `{"error":"internal_error"}`.

Server-truth events (`join_failed`, `round_started`, `round_finished`,
  `session_ended`) are also sent to Umami via `POST /api/send`
  with the player's ip/userAgent overrides (requires Umami ≥ 2.17),
  so they land in the same Umami session as the player's pageviews.
This needs `UMAMI_HOST` (or `UMAMI_SRC`) alongside `UMAMI_WEBSITE_ID`;
  without them the sender is a silent no-op.
Event data never contains room codes, nicknames, or IPs.

The GameAnalytics relay (`server/src/ga-relay.ts`) accepts the browser SDK's
  batches on `POST /api/ga/v2/<key>/events` and
  `POST /api/ga/remote_configs/v1/init`,
  re-signs the body with HMAC-SHA256(`GA_SECRET_KEY`),
  and forwards to the GameAnalytics Collection API.
It answers 202 and drops the batch when the collector is unreachable —
  analytics never blocks or retries into the game.
Read them in the Timeweb panel (app → Логи);
  they are also the durable history,
  since Prometheus counters reset on every deploy.

Env vars: `LOG_LEVEL` (default `info`),
  `NODE_ENV=production` for JSON output (the Dockerfile sets it),
  `RATE_LIMITS=off` for local load tests only — never in production.

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
Re-run procedure and what to record:
  [ops/bench-baseline.md](ops/bench-baseline.md).

## Flamegraphs

```sh
RATE_LIMITS=off PORT=3100 npm run flame -w server
```

That builds and runs the server under `0x`;
  drive load with `bench:ws`, then Ctrl-C to open the interactive flamegraph.
Capture dirs (`*.0x/`) are gitignored.
For async-stall hunting, `npx clinic doctor -- node server/dist/server.js`
  is the next tool up; profile locally, never on the prod app.
