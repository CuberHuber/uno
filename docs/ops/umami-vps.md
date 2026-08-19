# Umami на VPS: переименование трекера и гигиена IP

Это раздел «руками» из плана
  `docs/superpowers/plans/2026-08-19-observability-rollout.md`,
  Этап 5 (T5.1, T5.2), гейт G4.
Применяет пользователь лично на своём VPS,
  где self-hosted Umami 2.x работает в Docker;
  код игры эти изменения не трогают.

Реальные значения — домен Umami, ID сайта, свои IP —
  в этот файл и в репозиторий не попадают.
Ниже везде плейсхолдеры: `<UMAMI_HOST>`, `<WEBSITE_ID>`, `<YOUR_IP>`.

## Зачем (гейт G4: переименование, согласовано)

Общие списки блокировки рекламы (adblock/uBlock)
  режут запросы к путям вида `script.js` и `/api/send` —
  это сигнатуры дефолтной инсталляции Umami, а не домен как таковой.
Переименование пути скрипта и пути сбора событий
  уводит трафик аналитики из-под этих generic-правил,
  не трогая сам домен и не требуя отдельного поддомена.

## 1. `TRACKER_SCRIPT_NAME` — переименовать скрипт трекера

Переменная окружения контейнера Umami задаёт,
  под каким именем сервер отдаёт клиентский трекер
  вместо дефолтного `script.js`.
Имя произвольное, лишь бы не совпадало с типовыми
  паттернами блок-листов (`script.js`, `umami.js`, `analytics.js`);
  ниже используется пример `metrics.js` — замените на своё.

```env
TRACKER_SCRIPT_NAME=metrics.js
```

**Сопутствующая правка:** после смены имени скрипта на VPS
  нужно поправить `UMAMI_SRC` на сайте —
  в панели хостинга сайта игры (Timeweb → приложение →
  переменные окружения) значение должно указывать на новый путь:

```env
UMAMI_SRC=https://<UMAMI_HOST>/metrics.js
```

Сохранение переменной в панели Timeweb = полный редеплой приложения
  (см. `docs/monitoring.md`); учитывайте это при планировании окна.

## 2. `COLLECT_API_ENDPOINT` — переименовать путь сбора событий

Аналогично переименовывает путь, куда трекер шлёт события,
  вместо дефолтного `/api/send`.

```env
COLLECT_API_ENDPOINT=/api/beacon
```

Правка на стороне клиента игры не нужна:
  отданный сервером файл трекера сам знает новый путь сбора
  (он зашит в тот же ответ, что отдаёт `TRACKER_SCRIPT_NAME`),
  так что `UMAMI_SRC` на сайте остаётся единственной точкой связки.

## 3. `CLIENT_IP_HEADER` и `IGNORE_IP` — гигиена IP за прокси

VPS с Umami обычно стоит за reverse-proxy,
  поэтому без указания заголовка Umami видит IP самого прокси
  и на все визиты — а не реальный IP посетителя,
  из-за чего разные люди слипаются в одного визитора.

```env
CLIENT_IP_HEADER=X-Forwarded-For
```

`IGNORE_IP` исключает из статистики адреса владельца
  (разработку, ручные проверки, curl-пробы) —
  список через запятую, без пробелов:

```env
IGNORE_IP=<YOUR_IP>
```

Если у владельца несколько адресов (дом, VPN, мобильный),
  перечислите все через запятую: `IGNORE_IP=<YOUR_IP>,<YOUR_IP_2>`.

## docker compose: пример блока `environment`

Ниже — только новые/меняющиеся ключи для сервиса `umami`
  в существующем `docker-compose.yml`;
  остальные переменные (`DATABASE_URL`, `APP_SECRET` и так далее)
  трогать не нужно, оставьте как есть.

```yaml
services:
  umami:
    image: ghcr.io/umami-software/umami:postgresql-latest
    environment:
      TRACKER_SCRIPT_NAME: metrics.js
      COLLECT_API_ENDPOINT: /api/beacon
      CLIENT_IP_HEADER: X-Forwarded-For
      IGNORE_IP: <YOUR_IP>
    restart: always
```

## docker run: тот же набор через `-e`

Если Umami поднят без compose, напрямую через `docker run`
  (или через `docker update` + пересоздание контейнера):

```sh
docker run -d \
  --name umami \
  -e TRACKER_SCRIPT_NAME=metrics.js \
  -e COLLECT_API_ENDPOINT=/api/beacon \
  -e CLIENT_IP_HEADER=X-Forwarded-For \
  -e IGNORE_IP=<YOUR_IP> \
  # ...остальные уже настроенные -e (DATABASE_URL и т.д.) и -p как были
  ghcr.io/umami-software/umami:postgresql-latest
```

## Применение изменений

```sh
# вариант с docker compose (пересоздаёт контейнер с новым окружением)
docker compose up -d --force-recreate umami

# вариант с обычным docker run — остановить и поднять заново
docker stop umami && docker rm umami
# затем повторить docker run с обновлёнными -e выше
```

После перезапуска Umami не забудьте про шаг 1:
  поправить `UMAMI_SRC` в панели Timeweb на сайте игры
  и дождаться редеплоя приложения.

## Проверка

Скрипт трекера отдаётся по новому пути:

```sh
curl -sI "https://<UMAMI_HOST>/metrics.js" | head -1
# ожидание: HTTP/2 200
```

Путь сбора событий принимает событие:

```sh
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST "https://<UMAMI_HOST>/api/beacon" \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: Mozilla/5.0' \
  -d '{"type":"event","payload":{"website":"<WEBSITE_ID>","url":"/","hostname":"<UMAMI_HOST>"}}'
# ожидание: 200 или 201; событие появляется в Umami → Realtime
```

IP-гигиена проверяется в самом Umami, не curl'ом:

- откройте сайт со своего адреса (того же, что в `IGNORE_IP`) —
  в Umami → Realtime визит не должен появиться;
- откройте сайт с двух разных реальных устройств/сетей —
  в Realtime это должны быть два разных визитора,
  а не один и тот же IP (признак того, что `CLIENT_IP_HEADER`
  до этого не был выставлен и прокси схлопывал всех в один адрес).
