# Инструкции для GitHub Copilot

Сначала прочитайте [AGENTS.md](../AGENTS.md); для Go — также [server/AGENTS.md](../server/AGENTS.md),
для `kmp/` (Kotlin Multiplatform) — [kmp/AGENTS.md](../kmp/AGENTS.md).
Для ревью используйте [REVIEW.md](../REVIEW.md). Общие правила и матрица проверок находятся там.

- Документация, комментарии, тексты UI и коммиты — на русском; идентификаторы — на английском.
- Слои: `screens → components/app/api → domain/lib`. Данные UI — через `src/api/queries.ts`.
  Новый метод: `api.ts` + `http.ts` + `local.ts` + query keys/хук/инвалидация + Go-хендлер и тест.
- Контракт: Go `server/internal/model` ↔ TS `src/domain/types.ts` и DTO в `http.ts`.
  Даты — через `lib/dates.ts`; месяц в TS с 0, в `/api/month` с 1.
- Маршруты данных требуют авторизации; владелец берётся из контекста, а не из тела запроса.
  Изменения `store.Store` реализуйте в JSON- и PostgreSQL-хранилищах.
- Для мутаций событий/задач определите поведение офлайн (`offline.ts`/`outbox.ts`).
  Смена аккаунта не изолирует очередь и Workbox-кэш автоматически; учитывайте ограничения в `AGENTS.md`.
- Запись событий — через `*EventSynced` в `api/calendars.go`; HTTP календарей — через `calsync.Net`;
  секреты — через `secret.Box`. Участники задач — `shareTaskWith`, новые упоминания — `newMentions`.
- Цикл инструментов и промпт — `api/chat.go`, HTTP/SSE модели — `internal/llm`.
  Подтверждение удаления сейчас задано промптом, отдельной серверной проверки нет.
- Без `eslint-disable`, `!important` и `as any`. Таймеры — `lib/hooks.ts`, колбэки в эффектах — `useEffectEvent`.
  Стили — CSS Modules и токены, модалки — `BottomSheet`, нижняя панель — `BarSlot`.
- Проверки — по Definition of Done в `AGENTS.md`: фронтенд — check/сборка, Go — gofmt/vet/race,
  UI — браузер, документация — форматирование/пути/команды. PostgreSQL-тесты требуют одноразовой БД
  и очищают таблицы; без `TEST_DATABASE_URL` они пропускаются.
- Сохраняйте чужие изменения, проверяйте ветку перед push, не переписывайте историю.
  Push в GitHub и деплой на сервер — разные действия. Не называйте пропущенные проверки успешными.
- `kmp/`: данные — через `CalendarApi` и `CalendarController`, контракт `api/Models.kt` ↔ Go `model`; цвета — токены `Theme.kt`;
  шторки — `AppSheet` с `SheetFooter`; удаление — с отменой; вибрация — `Haptics`. Проверки — `./gradlew :shared:jvmTest
:shared:compileKotlinWasmJs :androidApp:assembleDebug`; CI `kmp/` не собирает.
