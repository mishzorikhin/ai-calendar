# server/AGENTS.md — бэкенд на Go

Общие правила проекта — в корневом `AGENTS.md`. Здесь — то, что важно именно для `server/`.

## Стек и принципы

- Go 1.24, **только стандартная библиотека.** Не добавляйте зависимости без явной необходимости;
  если всё же нужно — обоснуйте в описании коммита.
- Маршрутизация — `http.ServeMux` с шаблонами Go 1.22 (`"GET /api/events/{id}"`, `r.PathValue`).
- Логи — `log/slog` (JSON в stdout). Конфигурация — только переменные окружения (`cmd/server/main.go`).
- UI встраивается через `go:embed` из `web/dist` (Dockerfile копирует туда `dist/` фронтенда).

## Структура

```
cmd/server/       main: env-конфиг, graceful shutdown, флаг -healthcheck
internal/model/   типы API (JSON-поля = src/domain/types.ts на фронтенде)
internal/seed/    заведения, отзывы, типовое расписание дня, точки месяца
internal/store/   хранилище: JSON-файл, атомарная запись (tmp + rename), sync.RWMutex
internal/api/     http.go (ошибки, JSON, middleware), api.go (хендлеры), spa.go (раздача UI)
web/              embed.go + dist/ (собранный UI, в git только README)
```

## Как писать хендлеры

- Сигнатура — `handlerFunc func(w, r) error`. Ошибки клиента — `badRequest(...)`, `notFound(...)`
  или `&apiError{Status: 409, Message: ...}`; всё остальное станет 500 с общим текстом и попадёт в лог.
- Тело запроса — только через `readJSON` (лимит 64 КБ, `DisallowUnknownFields`, ровно один объект).
- Ответ — `writeJSON(w, status, v)`. Тексты ошибок — по-русски и понятны пользователю
  (фронтенд показывает их как есть).
- Валидируйте всё: даты `ГГГГ-ММ-ДД` (`parseDate`), минуты 0…1440 (`validateRange`), длины строк
  в рунах (`utf8.RuneCountInString`), перечисления (`Badge.Valid()`).
- Новый эндпоинт: маршрут в `New()` → хендлер → тест в `api_test.go` → метод в `src/api/api.ts`,
  реализации в `http.ts` и `local.ts`, хук в `queries.ts` → строка в таблице API в `README.md`.

## Хранилище

- Все изменения — под `s.mu.Lock()`, затем `s.save()`; чтения — под `RLock` и возвращают копии
  (`slices.Clone`), чтобы вызывающий не менял внутреннее состояние.
- `Open("")` — хранение в памяти (для тестов). Формат `data.json` меняйте обратно совместимо:
  новые поля с нулевыми значениями по умолчанию.

## Проверки

```bash
gofmt -l .            # должно быть пусто
go vet ./...
go test -race ./...
go run ./cmd/server   # с DATA_DIR=/tmp/aical, STATIC_DIR=../dist при необходимости
```

Тесты API — через `httptest` и `store.Open("")`, статика — `fstest.MapFS`. На каждую ветку
валидации — свой случай (см. `TestEventValidation`).

## Docker

- Образ: Node (сборка UI) → Go (`CGO_ENABLED=0`, `-trimpath`, версия через `-X main.version`) →
  `distroless/static:nonroot`. Данные — том `/data` (uid 65532), `HEALTHCHECK` вызывает `-healthcheck`.
- Кэш-заголовки SPA важны для PWA: `assets/*` — immutable, `index.html`/`sw.js`/манифест — `no-cache`.
  Не меняйте их без проверки обновления service worker.
