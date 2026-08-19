# Umami: очистка старых данных в Postgres

Self-hosted Umami 2.x хранит сырые события бессрочно,
  и база на VPS растёт без ограничений.
Политика проекта: сырьё храним 365 дней,
  всё старше удаляется cron-задачей раз в сутки.
Агрегаты в дашбордах Umami считаются из сырых событий,
  так что годовое окно — это и глубина доступной истории.

Реальные адреса и учётки в репозиторий не попадают, плейсхолдеры:

| Плейсхолдер | Что подставить |
|---|---|
| `<UMAMI_HOST>` | VPS, где развёрнут Umami |
| `<DB_CONTAINER>` | имя контейнера Postgres из compose-файла Umami |
| `<DB_USER>` / `<DB_NAME>` | пользователь и база Umami в Postgres |

## SQL-скрипт

Положить на VPS, например в `/opt/umami/cleanup.sql`:

```sql
-- Umami 2.x: чистка сырых данных старше 365 дней.
-- Порядок важен: сначала зависимые таблицы, затем родительские.
DELETE FROM event_data    WHERE created_at < now() - interval '365 days';
DELETE FROM website_event WHERE created_at < now() - interval '365 days';
DELETE FROM session_data  WHERE created_at < now() - interval '365 days';
DELETE FROM session       WHERE created_at < now() - interval '365 days';
```

Замечания:

- `session_data` появилась в поздних версиях 2.x;
  если таблицы нет, строку просто убрать.
- Соль сессионного хеша Umami ротируется,
  поэтому у сессии старше года не бывает свежих событий —
  удаление безопасно.
- Таблицы `website`, `user`, `report` не трогаем:
  это настройки, а не сырьё.

## Cron

На `<UMAMI_HOST>` в `crontab -e` пользователя с доступом к Docker:

```cron
# Umami: чистка данных старше 365 дней, ежедневно в 04:15
15 4 * * * docker exec -i <DB_CONTAINER> psql -U <DB_USER> -d <DB_NAME> -v ON_ERROR_STOP=1 < /opt/umami/cleanup.sql >> /var/log/umami-cleanup.log 2>&1
```

`ON_ERROR_STOP=1` обрывает прогон на первой ошибке,
  чтобы не удалять родительские строки при упавшей чистке зависимых.
Время 04:15 — ночной минимум трафика;
  сдвинуть, если на VPS есть другие ночные задачи (бэкапы и т. п.).

## Проверка

После первого запуска:

```sh
tail -n 20 /var/log/umami-cleanup.log
docker exec -i <DB_CONTAINER> psql -U <DB_USER> -d <DB_NAME> \
  -c "SELECT min(created_at) FROM website_event;"
```

Минимальная дата не должна быть старше ~366 дней.
Место на диске возвращает автовакуум;
  после самой первой массовой чистки можно один раз ускорить вручную:

```sh
docker exec -i <DB_CONTAINER> psql -U <DB_USER> -d <DB_NAME> \
  -c "VACUUM ANALYZE website_event, event_data, session;"
```

Раз в квартал стоит глянуть размер базы
  (`SELECT pg_size_pretty(pg_database_size('<DB_NAME>'));`)
  и при взрывном росте пересмотреть окно хранения.
