# Grafana Cloud: скрейп `/metrics` и алерты

Сервер отдаёт Prometheus-метрики на `GET /metrics`:
  серии `ochre_*` плюс стандартные `nodejs_*` и `process_*`.
Панель Timeweb кастомные метрики не собирает,
  поэтому снаружи их скрейпит Grafana Cloud (хватает бесплатного тарифа).
Реальные адреса и токены в репозиторий не попадают:
  ниже везде плейсхолдеры вида `<APP_DOMAIN>`,
  значения живут в панели Grafana Cloud и в секретах VPS.

| Плейсхолдер | Что подставить |
|---|---|
| `<APP_DOMAIN>` | прод-домен приложения |
| `<GRAFANA_PROM_URL>` | remote-write URL стека, вида `https://prometheus-<N>.grafana.net/api/prom/push` |
| `<GRAFANA_PROM_USER>` | числовой user id инстанса Prometheus из настроек стека |
| `<GRAFANA_CLOUD_TOKEN>` | API-токен с правом `metrics:write`, хранить только в секретах |

## Вариант A — Metrics Endpoint (agentless, рекомендуется)

Ничего не ставится ни на VPS, ни в приложение:
  Grafana Cloud сама ходит по HTTPS раз в минуту.

1. В стеке Grafana Cloud открыть
   **Connections → Add new connection → Metrics Endpoint**.
2. Указать scrape URL `https://<APP_DOMAIN>/metrics`,
   имя джоба `ochre-eights`, интервал 60 s.
   Эндпоинт публичный и без аутентификации,
     поэтому поля credentials остаются пустыми.
3. Сохранить и дождаться первой точки:
   в **Explore** запрос `ochre_rooms_open` должен вернуть серии.

Бесплатный тариф держит 10k активных серий —
  наш экспорт (порядка трёх десятков серий) занимает доли процента.

## Вариант B — свой Prometheus или Alloy на VPS

Запасной путь, если agentless-интеграция недоступна.
Скрейпить может тот же VPS, где живёт Umami.

```yaml
scrape_configs:
  - job_name: ochre-eights
    scheme: https
    metrics_path: /metrics
    scrape_interval: 60s
    static_configs:
      - targets: ['<APP_DOMAIN>']

remote_write:
  - url: <GRAFANA_PROM_URL>
    basic_auth:
      username: <GRAFANA_PROM_USER>
      password: <GRAFANA_CLOUD_TOKEN>
```

Токен в файл не вписывать:
  подставлять из секрет-хранилища или через `password_file`.

## Алерты

Три правила из плана наблюдаемости (этап 6).
Счётчики `ochre_*_total` сбрасываются при каждом деплое,
  поэтому в выражениях всегда `rate()` / `increase()`,
  а не сырые значения.

```yaml
groups:
  - name: ochre-eights
    rules:
      # 1. Сервер недоступен 5 минут подряд.
      - alert: OchreServerDown
        expr: up{job="ochre-eights"} == 0
        for: 5m
        labels: { severity: critical }
        annotations:
          summary: "/metrics не отвечает 5 минут — приложение лежит или сеть"

      # 2. Всплеск неудачных попыток входа в комнату.
      #    0.05/с = 3 отказа в минуту устойчиво в течение 15 минут;
      #    порог стартовый, подобрать по реальному трафику.
      - alert: OchreJoinFailuresSpike
        expr: sum(rate(ochre_joins_failed_total[15m])) > 0.05
        for: 15m
        labels: { severity: warning }
        annotations:
          summary: "Игроки массово не могут сесть за стол (пины, полные столы, лимиты)"

      # 3. Ноль открытых комнат в прайм-тайм — подозрение на тихую поломку
      #    воронки при формально живом сервере.
      - alert: OchreNoRoomsPrimeTime
        expr: sum(ochre_rooms_open) == 0
        for: 30m
        labels: { severity: warning }
        annotations:
          summary: "30 минут подряд нет ни одной комнаты в прайм-тайм"
```

Правило 3 должно звучать только вечером:
  в Grafana Alerting это делается mute timing'ом,
  который глушит уведомления вне окна 18:00–23:00 по Москве
  (Alert rules → Notification policies → Mute timings).
Каналы доставки (Telegram, e-mail) настраиваются там же,
  в contact points стека — токены ботов в репозиторий не попадают.

## Проверка после настройки

1. `ochre_rooms_open` и `nodejs_eventloop_lag_seconds`
   рисуются в Explore за последний час.
2. Тестовый алерт: временно поставить в правиле 1 порог `up == 1`,
   убедиться, что уведомление пришло, вернуть обратно.
3. Дашборд-минимум: комнаты по фазам, игроки, сокеты,
   `histogram_quantile(0.95, ...)` по `ochre_round_duration_seconds`,
   лаг event loop и RSS процесса.
