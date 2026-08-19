# План внедрения наблюдаемости (observability rollout)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** довести аналитику и мониторинг сайта карточной игры до состояния,
  когда Umami и GameAnalytics показывают полную картину:
  воронку, retention, ошибки и нагрузку.

**Architecture:** основа уже написана на ветке `worktree-observability`
  (клиентский модуль `client/src/analytics.ts`, серверный `server/src/analytics.ts`,
  `/config.js`, `/healthz`, `/metrics`).
План вливает её в main и наращивает тремя слоями:
  видимость ошибок, единая таксономия событий, серверная отправка.

**Tech Stack:** TypeScript, Fastify + socket.io, pino, prom-client,
  Umami self-hosted 2.x, GameAnalytics JS SDK 5.x (npm-пакет `gameanalytics`).

**Spec:** отчёт «Игра под наблюдением» —
  https://claude.ai/code/artifact/e8031039-48c5-4a77-af78-7a1cfd4540e1
  (пакеты П0–П7 и вопросы согласования 1–6).

## Global Constraints

- Реальные ID, домены и ключи в репозиторий не попадают:
  только env через панель Timeweb или gitignored `.env`.
- Имя «UNO» в коде, документах и событиях не используется.
- Порт 3000 остаётся свободным; dev-сервер запускает пользователь.
- В main изменения попадают только через PR.
- Локальный Node по умолчанию — 18: не использовать `import.meta.dirname`.
- Имена событий: Umami ≤ 50 символов, сегмент GameAnalytics ≤ 64;
  без кодов комнат, ников и точных чисел в именах.
- Бюджет GameAnalytics: ~500 событий на пользователя в день —
  никаких покарточных событий.
- Перед публикацией чего-либо в GitHub issues — спросить пользователя.

## Гейты согласования

Все шесть решений согласованы пользователем 19.08.2026 —
  ни одна задача плана больше не заблокирована.

| Гейт | Решение из отчёта | Блокирует | Статус |
|---|---|---|---|
| G1 | Вливать ветку observability | Этап 0 целиком | ✅ согласовано; влито PR #22 |
| G2 | Таксономия событий | Этап 2 | ✅ согласовано |
| G3 | GameAnalytics relay через Fastify | T3.2 | ✅ согласовано |
| G4 | Переименование трекера Umami на VPS | T5.1 | ✅ согласовано (rename) |
| G5 | Первый A/B-тест | T4.3 | ✅ согласовано (после 2–3 недель данных) |
| G6 | Остаться на Umami 2.x | ничего не блокирует (справочно) | ✅ согласовано |

---

## Этап 0 — Фундамент: мерж и включение (П0, ~0.5 дня)

### Task 0.1: Влить `worktree-observability` в main

**Files:**
- Modify: конфликтные места `server/src/sockets.ts`, `client/src/store.tsx`
  (ветка от `4bffb4d`, отстаёт от main с rules-onboarding)

**Interfaces:**
- Produces: в main появляются `client/src/analytics.ts` (`initAnalytics()`, `track(name, data)`),
  `server/src/analytics.ts` (класс `Analytics`), `server/src/metrics.ts`,
  маршруты `GET /config.js`, `GET /healthz`, `GET /metrics`.

> **Выполнено 19.08.2026:** ветка влита в main через PR #22
>   (`0b98c20`, коммиты ebfe6a4…6a6fcc9);
>   в main проверено наличие `client/src/analytics.ts`, `server/src/analytics.ts`,
>   `server/src/metrics.ts`, `docs/monitoring.md`.

- [x] **Step 1:** обновить ветку: `git fetch origin && git checkout worktree-observability && git merge origin/main`.
- [x] **Step 2:** разрешить конфликты в `sockets.ts` / `store.tsx`,
  сохранив обе стороны: хуки телеметрии ветки и rules-onboarding из main.
- [x] **Step 3:** прогнать проверку: `npm run typecheck && npm test -w server && npm run build`.
Ожидание: все тесты зелёные, включая `server/test/observability.test.ts` и `analytics.test.ts`.
- [x] **Step 4:** прогнать design-смоук из прошлых сессий или `qa_smoke`-скрипт
  на собранном сервере (создание комнаты, полный раунд).
- [x] **Step 5:** открыть PR `worktree-observability → main`, влить после ревью.

### Task 0.2: Аккаунты и env в панели (руками пользователя, чеклист)

> **Выполнено:** env применены в панели (вторая попытка сохранения —
>   панель требует правку Deploy Configuration; сохранение = полный редеплой).

- [x] **Step 1:** создать сайт в self-hosted Umami → получить website ID.
- [x] **Step 2:** создать игру в GameAnalytics → получить game key и secret key.
- [x] **Step 3:** прописать в панели Timeweb:
  `UMAMI_WEBSITE_ID`, `UMAMI_SRC`, `UMAMI_DOMAINS` (только прод-домен),
  `GA_GAME_KEY`, `GA_SECRET_KEY`, `LOG_LEVEL=info`.
- [x] **Step 4:** проверить версию инсталляции Umami:
  минимум 2.17 (для серверной отправки), рекомендуется 2.19/2.20.x.

### Task 0.3: Проверка прода после деплоя

> **Выполнено, проверено браузерным пробом на проде:** Umami script 200
>   и `/api/send` 200 (pageview записан), GameAnalytics init 201 / events 200,
>   `/healthz` JSON, `/metrics` — 28 серий `ochre_*`.
> Перенесено в этап 6: health-check path в панели и Grafana-scrape.

- [x] **Step 1:** `curl https://<домен>/config.js` — отдаёт значения, не пустоту.
- [x] **Step 2:** `curl https://<домен>/healthz` — JSON со счётчиками комнат.
- [x] **Step 3:** открыть сайт — в Umami Realtime появился визит;
  в GameAnalytics (Live feed) появилась сессия.
- [x] **Step 4:** убедиться, что `fly.toml` удалён из main (ветка это делает).

**Критерий приёмки этапа:** прод шлёт pageview и сессии; `/healthz` и `/metrics` живые.

---

## Этап 1 — Видимость клиентских ошибок (П1, ~1–2 дня)

### Task 1.1: Модуль report-ошибок с дедупликацией

**Files:**
- Create: `client/src/errors.ts`
- Modify: `client/src/main.tsx` (вызов `initErrorReporting()` после `initAnalytics()`)

**Interfaces:**
- Consumes: `track(name, data)` и GA-хендл из `client/src/analytics.ts`.
- Produces: `initErrorReporting(): void`; `reportError(kind: string, err: unknown, severity?: 'warning'|'error'|'critical'): void`.

> **Выполнено — PR #24 (влит 19.08.2026)**

- [x] **Step 1:** написать чистую функцию `shouldReport(key: string): boolean` —
  дедуп по ключу `kind:message` и лимит 10 ошибок за сессию —
  и unit-тест на неё (та же схема раннера, что в `server/test`; если в client
  раннера нет — вынести функцию в shared-утилиту и покрыть тестом сервера).
Тест: первый вызов true, повтор того же ключа false, 11-я уникальная ошибка false.
- [x] **Step 2:** реализовать модуль:

```ts
// client/src/errors.ts
import { track, gaAddError } from './analytics';

const seen = new Set<string>();
let sent = 0;
const LIMIT = 10;

export function shouldReport(key: string): boolean {
  if (sent >= LIMIT || seen.has(key)) return false;
  seen.add(key);
  sent += 1;
  return true;
}

export function reportError(kind: string, err: unknown, severity: 'warning' | 'error' | 'critical' = 'error') {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const key = `${kind}:${msg}`.slice(0, 200);
  if (!shouldReport(key)) return;
  console.warn(`[error-report] ${kind}`, err);
  track('client_error', { kind });
  const stack = err instanceof Error && err.stack ? `\n${err.stack}` : '';
  gaAddError(severity, `${kind}: ${msg}${stack}`.slice(0, 8192));
}

export function initErrorReporting() {
  window.addEventListener('error', (e) => reportError('window_onerror', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => reportError('unhandled_rejection', e.reason));
}
```

- [x] **Step 3:** экспортировать из `analytics.ts` обёртку `gaAddError(severity, message)`
  (внутри — маппинг на `EGAErrorSeverity`; no-op, пока GA не инициализирован).
- [x] **Step 4:** `npm run typecheck && npm run build`; commit.

### Task 1.2: Слушатели WebSocket

**Files:**
- Modify: `client/src/socket.ts:5` (после создания `io(...)`)

> **Выполнено — PR #24 (влит 19.08.2026)**

- [x] **Step 1:** повесить слушатели:
  `socket.io.on('reconnect_attempt', ...)`, `socket.on('connect_error', ...)`,
  `socket.on('disconnect', reason => ...)` →
  `console.warn` + `reportError('ws_'+вид, ..., 'warning')`, не чаще одного в минуту.
- [x] **Step 2:** вручную проверить: остановить сервер на 5 секунд при открытом столе —
  в консоли warning, событие ушло один раз.
- [x] **Step 3:** commit.

### Task 1.3: Ack повторного входа и баннер своего дисконнекта

**Files:**
- Modify: `client/src/store.tsx:59–68` (обработчик `reconnect`, ack сейчас игнорируется)
- Modify: `client/src/components/PauseOverlay.tsx` или новый баннер в `Table.tsx`

> **Выполнено — PR #24 (влит 19.08.2026)**

- [x] **Step 1:** в ack пере-join обработать ошибку:
  показать состояние «стол недоступен» + событие `reconnect_failed` с `reason`.
- [x] **Step 2:** добавить в store флаг `selfDisconnected`
  (из `socket.on('disconnect')` / `connect`), в Table — баннер
  «соединение потеряно, переподключаемся…» по этому флагу.
- [x] **Step 3:** ручная проверка обоих состояний (остановить сервер / вернуть сервер).
- [x] **Step 4:** commit.

### Task 1.4: `HostLink.create` перестаёт глотать ошибки

**Files:**
- Modify: `client/src/screens/HostLink.tsx:15–27`

> **Выполнено — PR #24 (влит 19.08.2026)**

- [x] **Step 1:** обернуть fetch: проверять `res.ok`;
  при 429 показать локализованную ошибку `rate_limited`, при сетевой — общую;
  событие `room_create_failed` с `reason`; `catch` на `clipboard.writeText`.
- [x] **Step 2:** ручная проверка: временно дёрнуть создание комнат в цикле до 429 —
  ошибка видна, консоль чистая.
- [x] **Step 3:** commit.

**Критерий приёмки этапа:** искусственный `throw` на лендинге виден
  в GameAnalytics Health и в Umami как `client_error`;
  обрыв сети показывает баннер и создаёт warning-событие.

---

## Этап 2 — Единая таксономия событий (П2, гейт G2, ~1–2 дня)

### Task 2.1: Расширение клиентского analytics-модуля

**Files:**
- Modify: `client/src/analytics.ts`

**Interfaces:**
- Produces: `track(name, data?)` (уже есть; данные начинают уходить и в GA как value),
  `trackProgression(status: 'Start'|'Complete'|'Fail', mode: string, bucket: string, score?: number)`,
  `setDimensions(d: {role?: string; form?: string; rules?: string})`,
  вызов `configureBuild(APP_VERSION)` до `initialize`.

> **Выполнено — PR #25 (открыт 19.08.2026)**

- [x] **Step 1:** передавать в design-события числовое value из `data.value`, если есть.
- [x] **Step 2:** добавить `trackProgression` поверх `addProgressionEvent`
  (`round:<mode>:<bucket>`, score только у Complete).
- [x] **Step 3:** `configureAvailableCustomDimensions01..03` до init:
  dim01 `['host','guest']`, dim02 `['mobile-web','desktop-web']`,
  dim03 — пресеты правил; `configureBuild` из `window.__CONFIG__.APP_VERSION`
  (прокинуть в `/config.js` из env либо из версии пакета при сборке).
- [x] **Step 4:** `data-before-send`-нормализация URL комнат `/r/:code`
  (или переопределение url в `track`-payload).
- [x] **Step 5:** typecheck + build; commit.

### Task 2.2: Клиентские события по карте аудита

**Files:**
- Modify: `client/src/screens/Landing.tsx:78–81, 113, 116, 208, 222–225`
- Modify: `client/src/screens/HostLink.tsx:22, 66`
- Modify: `client/src/screens/Lobby.tsx:45, 51, 61`
- Modify: `client/src/screens/Table.tsx:287–296, 855, 869`
- Modify: `client/src/screens/RoundOver.tsx:40`
- Modify: `client/src/store.tsx:71–86`

> **Выполнено — PR #25 (открыт 19.08.2026)**

- [x] **Step 1:** события `landing_cta {variant}`, `room_join {role, resume}`,
  `rules_toggle {rule, on}`, `help_open`, `slide_viewed {closedBy}`, `rematch`.
- [x] **Step 2:** дедуп `round_started` при reconnect:
  слать только на первом флипе фазы в данной партии
  (сравнивать номер партии `roundsPlayed(winTally)`).
- [x] **Step 3:** progression: `Start` на старте раунда,
  `Complete` (score = очки) у победителя, `Fail` у остальных, mode = пресет правил,
  bucket = `2p`/`3-4p`.
- [x] **Step 4:** ручная проверка через Umami Realtime на dev-инсталляции
  (или логом `track`-вызовов): пройти путь лендинг → комната → раунд → rematch,
  увидеть все события ровно по одному разу.
- [x] **Step 5:** commit.

### Task 2.3: Серверные события и счётчики

**Files:**
- Modify: `server/src/sockets.ts:30–50` (joinRoom ack), `server/src/rooms.ts:104–125, 155–170, 184–187`
- Modify: `server/src/analytics.ts`, `server/src/metrics.ts`
- Test: `server/test/analytics.test.ts`

> **Выполнено — PR #25 (открыт 19.08.2026)**

- [x] **Step 1:** тест: неуспешный join с `wrong_pin` инкрементит
  `ochre_joins_failed_total{reason="wrong_pin"}` и пишет pino-строку `join_failed`.
- [x] **Step 2:** реализовать `joinFailed(reason)` в классе `Analytics` + counter в metrics.
- [x] **Step 3:** события `rules_changed`, `rematch` (номер партии), `player_kicked`
  (`continueWithout`), причины `moveRejected` — лог + counter.
- [x] **Step 4:** `npm test -w server`; commit.

**Критерий приёмки этапа:** в Umami строится Funnel
  лендинг → room_create/room_join → game_start → round_end → rematch;
  в GameAnalytics ожили Progression-дашборд и обе custom-dimension-разбивки.

---

## Этап 3 — Серверная отправка (П3, ~1–1.5 дня)

### Task 3.1: Umami server-side sender

**Files:**
- Create: `server/src/umami.ts`
- Modify: `server/src/analytics.ts` (фан-аут серверных событий), `server/src/sockets.ts`
  (прокинуть ip/user-agent соединения)
- Test: `server/test/umami-sender.test.ts`

**Interfaces:**
- Produces: `sendUmamiEvent(name: string, data: Record<string, unknown>, visitor?: {ip?: string; userAgent?: string}): Promise<void>` —
  fail-safe (ошибки только в лог), выключен без `UMAMI_WEBSITE_ID`.

- [ ] **Step 1:** тест с мок-сервером (undici MockAgent или локальный Fastify-стаб):
  payload содержит `{type:'event', payload:{website, name, url:'/srv', ip, userAgent}}`,
  заголовок User-Agent валидный, при 500 функция не бросает.
- [ ] **Step 2:** реализация: `fetch` на origin из `UMAMI_SRC` + `/api/send`,
  таймаут 3 с, очередь не нужна (события редкие);
  для чисто серверных агрегатов — env `UMAMI_SERVER_WEBSITE_ID` (опционально).
- [ ] **Step 3:** подключить к `join_failed`, `round_started/finished`, `session_ended`.
- [ ] **Step 4:** `npm test -w server`; commit.

### Task 3.2: GameAnalytics relay (гейт G3)

**Files:**
- Create: `server/src/ga-relay.ts` (маршрут `POST /api/ga`, HMAC-SHA256, gzip,
  форвард в `api.gameanalytics.com/v2/{key}/events`)
- Modify: `client/src/analytics.ts` (транспорт через свой домен),
  `server/src/server.ts:69–79` (`GA_SECRET_KEY` больше не отдаётся в `/config.js`)
- Test: `server/test/ga-relay.test.ts`

- [ ] **Step 1:** тест: relay подписывает тело HMAC-SHA256 (base64) от secret,
  не принимает тело больше 64 КБ, отвечает 202 и не падает при недоступности GA.
- [ ] **Step 2:** реализация relay + переключение клиента;
  secret остаётся только в env сервера.
- [ ] **Step 3:** проверить в GA Live feed, что события доходят; commit.

### Task 3.3: setErrorHandler и привязка сессий

**Files:**
- Modify: `server/src/server.ts` (`app.setErrorHandler`), `server/src/sockets.ts:91`
  (`session_ended` + код комнаты и место)

- [ ] **Step 1:** тест: брошенная в маршруте ошибка логируется pino со stack
  и отдаёт 500 JSON без внутренних деталей.
- [ ] **Step 2:** реализация; `session_ended` получает `room`, `seat`.
- [ ] **Step 3:** `npm test -w server`; commit.

**Критерий приёмки этапа:** серверные события видны в Umami в сессиях игроков;
  (при G3) события GA идут через свой домен, secret из браузера исчез.

---

## Этап 4 — Настройка отчётов в продуктах (П4, ~0.5 дня, без кода)

- [ ] **T4.1 Umami:** Funnel host / Funnel guest (окно 45 мин),
  Goals `game_start` и `rematch`, Journey, Share URL;
  UTM-разметка для будущих анонсов (DTF, Пикабу, Telegram).
- [ ] **T4.2 GameAnalytics:** проверить Overview/Engagement/Progression/Health;
  собрать главную воронку в Funnels; cohorts по dim01/dim02.
- [ ] **T4.3 (гейт G5):** первый A/B — онбординг-слайд правил,
  метрика D1 retention, запуск после 2–3 недель данных.

**Критерий приёмки:** каждая настроенная воронка показывает данные за последние сутки.

---

## Этап 5 — Анти-адблок и гигиена VPS (П5, ~0.5 дня, env)

- [ ] **T5.1 (гейт G4):** на VPS Umami задать `TRACKER_SCRIPT_NAME`,
  `COLLECT_API_ENDPOINT`; обновить `UMAMI_SRC` в панели Timeweb.
- [ ] **T5.2:** задать `CLIENT_IP_HEADER=x-forwarded-for` (за reverse proxy)
  и `IGNORE_IP` со своими адресами; перезапустить Umami; проверить,
  что сессии перестали слипаться (разные посетители в Realtime).
- [ ] **T5.3:** убедиться, что GameAnalytics грузится только npm-бандлом
  (CDN-сниппета нет) — уже так на ветке; зафиксировать проверкой в build.

---

## Этап 6 — Надёжность под нагрузкой (П6, ~1 день)

### Task 6.1: Graceful shutdown

**Files:**
- Modify: `server/src/server.ts` (entrypoint)
- Test: `server/test/shutdown.test.ts`

- [ ] **Step 1:** тест: после `SIGTERM` сервер закрывает socket.io и Fastify
  и завершает процесс кодом 0 в пределах 5 секунд.
- [ ] **Step 2:** реализация:

```ts
let shuttingDown = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ sig }, 'shutdown');
    const t = setTimeout(() => process.exit(1), 5000);
    t.unref();
    io.close(() => app.close().then(() => process.exit(0)));
  });
}
```

- [ ] **Step 3:** `npm test -w server`; commit.

### Task 6.2: Утечка `roundStartedAtMs` и очистка

**Files:**
- Modify: `server/src/analytics.ts:19` (Map), `server/src/rooms.ts:215–229` (`sweep()` вызывает очистку)
- Test: дополнить `server/test/analytics.test.ts`

- [ ] **Step 1:** тест: комната, удалённая sweep'ом посреди раунда,
  не оставляет записи в `roundStartedAtMs`.
- [ ] **Step 2:** реализовать `analytics.roomClosed(code)` и вызвать из sweep.
- [ ] **Step 3:** `npm test -w server`; commit.

### Task 6.3: Внешний мониторинг и очистка данных (VPS/панель)

- [ ] **Step 1:** подключить Grafana Cloud scrape к `/metrics`;
  алерты: сервер недоступен 5 минут; всплеск `rate(ochre_joins_failed_total[15m])`;
  0 открытых комнат в прайм-тайм.
- [ ] **Step 2:** cron на VPS Umami: удаление `website_event`/`event_data`/`session`
  старше 365 дней (раз в сутки).
- [ ] **Step 3:** прогнать `server/bench/http.mjs` и `server/bench/ws.mjs`
  на прод-конфигурации; сравнить с базлайном ветки
  (4 422 действия/с, p95 0.5 мс) и записать результат в `docs/monitoring.md`.

---

## Порядок и нарезка PR

| # | PR | Содержимое | Зависит от |
|---|---|---|---|
| 1 | merge observability | Этап 0 (T0.1) | G1 |
| 2 | client errors | Этап 1 | PR1 |
| 3 | event taxonomy | Этап 2 | PR1, G2 (можно параллельно с PR2) |
| 4 | server telemetry | T3.1 + T3.3 | PR3 |
| 5 | ga-relay | T3.2 | PR4, G3 |
| 6 | reliability | T6.1 + T6.2 | PR1 |

Этапы 4 и 5 — настройка в панелях, кода не содержат
  и выполняются между PR по мере готовности данных.
Суммарная оценка кода: 5–7 рабочих дней.

## Definition of Done (весь план)

- Прод шлёт pageview, события и сессии в оба продукта; ошибки клиентов видны в Health.
- Воронка лендинг → игра → rematch и retention строятся в обоих продуктах.
- KPI бэклога B-002 «доля комнат с более чем одной партией» измерим.
- `/metrics` скрейпится снаружи, три алерта активны.
- Деплой не рвёт сокеты (graceful shutdown), утечек в телеметрии нет.
