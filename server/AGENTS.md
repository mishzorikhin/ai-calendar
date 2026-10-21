# server/AGENTS.md — бэкенд на Go

Общие правила проекта — в корневом `AGENTS.md`. Здесь — то, что важно именно для `server/`.

## Стек и принципы

- Go 1.24, **стандартная библиотека + `pgx/v5`** (только для PostgreSQL-хранилища). Остальные зависимости
  не добавляйте без явной необходимости; если всё же нужно — обоснуйте в описании коммита.
  Пароли — `crypto/pbkdf2` из stdlib, HTTP-клиенты LLM и внешних календарей — `net/http`,
  XML CalDAV — `encoding/xml`, iCalendar — свой разбор в `internal/calsync`.
- Маршрутизация — `http.ServeMux` с шаблонами Go 1.22 (`"GET /api/events/{id}"`, `r.PathValue`).
- Логи — `log/slog` (JSON в stdout). Конфигурация — только переменные окружения (`cmd/server/main.go`).
- UI встраивается через `go:embed` из `web/dist` (Dockerfile копирует туда `dist/` фронтенда).

## Структура

```
cmd/server/       main: env-конфиг, выбор хранилища, graceful shutdown, флаг -healthcheck
internal/model/   типы API (JSON-поля = src/domain/types.ts на фронтенде)
internal/store/   интерфейс Store; store.go — JSON-файл (атомарная запись tmp + rename, sync.RWMutex),
                  postgres.go — PostgreSQL (миграции при старте, однократный импорт data.json)
internal/llm/     клиент OpenAI-совместимого API: цикл инструментов, SSE-стриминг, системный промпт
internal/calsync/ внешние календари: ical.go (разбор/запись iCalendar), expand.go (RRULE, EXDATE,
                  RECURRENCE-ID), convert.go (вхождение → события дней пользователя), net.go (HTTP-клиент
                  с запретом внутренней сети), ics.go, caldav.go, oauth.go, google.go, outlook.go;
                  fakecal/ — поддельные CalDAV и Google/Graph для тестов
internal/secret/  AES-GCM для паролей и токенов, HMAC-подпись OAuth state, ключ из SECRET_KEY или файла
internal/api/     http.go (ошибки, JSON, middleware), api.go (маршруты, события, задачи, лимиты),
                  auth.go (регистрация, вход, сессии, пояс), share.go (участники задач, @упоминания, уведомления),
                  chat.go (история и POST /api/chat), calendars.go (провайдеры, синхронизация, запись
                  событий во внешние календари, фоновый цикл), integrations.go (маршруты календарей,
                  OAuth, лента .ics), spa.go (раздача UI)
web/              embed.go + dist/ (собранный UI, в git только README)
```

## Аккаунты и доступ

- Все маршруты данных идут через `s.authed(...)`; пользователь лежит в контексте (`store.UserFrom(ctx)`),
  и **хранилище само фильтрует по нему** — не передавайте id пользователя из тела запроса.
- Пароль — PBKDF2-SHA256 с солью; токен сессии — 32 случайных байта, в базе только sha256-хэш,
  срок 30 дней со скользящим продлением. Токены и хэши не логируйте и не отдавайте в ответах
  (`publicUser` убирает лишнее).
- Логин уникален без учёта регистра; ошибки входа не должны выдавать, существует ли пользователь.
- Задачи видят владелец и участники (`task_members`); события, сообщения — только владелец.
  Новые `@логины` в названии/заметке парсятся сервером (`mentionUsernames`), участник получает
  уведомление (`notifyShare`). Права: владелец удаляет задачу у всех и снимает любых участников,
  участник — выходит сам.

## Внешние календари (`internal/calsync`, `api/calendars.go`)

- События внешних календарей лежат в той же таблице событий: `Source` — id подключения, `ExternalID` —
  id там (путь ресурса CalDAV, id Google/Graph), `ETag`, `ReadOnly`, `AllDay`. Синхронизация —
  `store.SyncEvents`: совпавшие по `ExternalID` обновляются **с сохранением id** (на него ссылаются UI
  и офлайн-очередь), лишние удаляются. Свои события (`Source == ""`) синхронизация не трогает.
- **Любая запись события — через `createEventSynced` / `updateEventSynced` / `deleteEventSynced`**, и в
  хендлерах, и в инструментах ассистента. Они проверяют `ReadOnly` (403), сначала пишут во внешний
  календарь, потом в хранилище. Отказ сервиса — 424 (не 5xx: офлайн-очередь не должна повторять вечно).
  Новое событие при недоступном календаре сохраняется локально, ошибка — в `Integration.LastError`.
- Дата + минуты ↔ время — только через пояс пользователя (`cal.location(user)`, `calsync.ItemOf`,
  `calsync.ToEvents`). Наружу время пишется в UTC, без VTIMEZONE.
- Секреты (пароль CalDAV, OAuth-токены) — только через `cal.box.Seal/Open`; наружу подключение отдаётся
  как `integrationView` (без секрета и полного URL подписки). Не логируйте пароли и токены.
- Внешние HTTP-запросы — только через `calsync.Net`: он запрещает адреса внутренней сети (проверка на
  этапе соединения, редиректы — вручную, с тем же методом). В тестах — `AllowPrivate: true`.
- Изменения синхронизации одного подключения — под `cal.lock(id)`; статус пишется в свежую копию.
- Тесты провайдеров и API — на `calsync/fakecal` (без сети); развёртку повторов покрывайте в `expand_test.go`.

## Ассистент (`internal/llm`)

- Инструменты описаны и исполняются в `internal/api/chat.go`: `get_day_schedule`, `find_free_slots`, `create_event`, `update_event`, `delete_event`,
  `list_tasks`, `create_task`, `update_task`, `delete_task`, `list_users`. Они вызывают то же хранилище
  с тем же контекстом пользователя, что и обычные хендлеры, и обязаны проходить ту же валидацию;
  `internal/llm` отвечает только за клиент, цикл и стриминг.
- Удаления — только после явного подтверждения пользователя (держит системный промпт; не ослабляйте).
- Ответ стримится событиями `delta`/`tool`/`done`; если провайдер не поддерживает `stream`, запрос
  повторяется обычным. Обе реплики сохраняются в историю. Тесты — на фейковом HTTP-сервере, без сети.
- Ключ — только `LLM_API_KEY` из окружения; без него чат отвечает заглушкой.

## Как писать хендлеры

- Сигнатура — `handlerFunc func(w, r) error`. Ошибки клиента — `badRequest(...)`, `notFound(...)`
  или `&apiError{Status: 409, Message: ...}`; всё остальное станет 500 с общим текстом и попадёт в лог.
- Тело запроса — только через `readJSON` (лимит 64 КБ, `DisallowUnknownFields`, ровно один объект).
- Ответ — `writeJSON(w, status, v)`. Тексты ошибок — по-русски и понятны пользователю
  (фронтенд показывает их как есть).
- Валидируйте всё: даты `ГГГГ-ММ-ДД` (`parseDate`), минуты 0…1440 (`validateRange`), длины строк
  в рунах (`utf8.RuneCountInString`), перечисления (`Badge.Valid()`).
- Новый эндпоинт: маршрут в `New()` → хендлер → тест в `api_test.go`/`auth_test.go` → метод в
  `src/api/api.ts`, реализации в `http.ts` и `local.ts`, хук в `queries.ts` (и поведение офлайн в
  `offline.ts`, если это мутация событий/задач) → строка в таблице API в `README.md`.
- Если эндпоинт нужен ассистенту — добавьте инструмент в `chat.go` и тест.
- Публичные маршруты (без `s.authed`) — только `health`, вход/регистрация, OAuth-колбэк (пользователь —
  из подписанного `state`) и лента `/api/feed/{token}.ics` (доступ — по секрету в ссылке).

## Хранилище

- Хендлеры работают только с интерфейсом `store.Store`; **любое изменение интерфейса — в обеих реализациях**
  (файловой и PostgreSQL) и в тестах обеих.
- Файловое: все изменения под `s.mu.Lock()`, затем `s.save()` (при ошибке записи — `rollback`); чтения под
  `RLock` и возвращают копии (`slices.Clone`).
- PostgreSQL: таблицы `users`, `sessions`, `events`, `messages`, `tasks`, `task_members`, `notifications`,
  `integrations` создаёт миграция при старте; миграции идемпотентные (`IF NOT EXISTS`) и без потери данных: новые колонки с `DEFAULT`.
  Тест — `TEST_DATABASE_URL=… go test ./internal/store -run TestPostgres` (без переменной пропускается).
- Общие сценарии для обеих реализаций — функцией в `store_test.go` (как `testIntegrations`), которую
  вызывают и файловый тест, и `TestPostgres…`.
- `Open("")` — хранение в памяти (для тестов). Формат `data.json` меняйте обратно совместимо:
  новые поля с нулевыми значениями по умолчанию. Записи без владельца (до аккаунтов) усыновляет
  первый зарегистрированный пользователь.

## Проверки

```bash
gofmt -l .            # должно быть пусто
go vet ./...
go test -race ./...
go run ./cmd/server   # с DATA_DIR=/tmp/aical, STATIC_DIR=../dist при необходимости;
                      # DATABASE_URL — PostgreSQL, LLM_API_KEY/LLM_BASE_URL/LLM_MODEL — ассистент
```

Тесты API — через `httptest` и `store.Open("")` (для защищённых маршрутов — с зарегистрированным
пользователем и Bearer-токеном, см. хелперы в `api_test.go`), статика — `fstest.MapFS`. На каждую ветку
валидации — свой случай (см. `TestEventValidation`).

## Docker

- `docker-compose.yml`: приложение + `postgres:17-alpine` (том `db-data`, пароль `DB_PASSWORD`);
  порт хоста — `APP_PORT`, секреты — в `.env` (не в git).
- Образ: Node (сборка UI) → Go (`CGO_ENABLED=0`, `-trimpath`, версия через `-X main.version`) →
  `distroless/static:nonroot`. Данные — том `/data` (uid 65532), `HEALTHCHECK` вызывает `-healthcheck`.
- Кэш-заголовки SPA важны для PWA: `assets/*` — immutable, `index.html`/`sw.js`/манифест — `no-cache`.
  Не меняйте их без проверки обновления service worker.
