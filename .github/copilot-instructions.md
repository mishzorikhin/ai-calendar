# Инструкции для GitHub Copilot

Правила проекта описаны в [`AGENTS.md`](../AGENTS.md) (общие), [`server/AGENTS.md`](../server/AGENTS.md)
(бэкенд на Go) и [`REVIEW.md`](../REVIEW.md) (ревью). Следуйте им. Самое важное:

- Комментарии, тексты интерфейса и коммиты — на русском; идентификаторы — на английском.
- Данные во фронтенде — только через `src/api/queries.ts`; новый метод API реализуется и в `http.ts`, и в `local.ts`.
- Маршруты данных требуют Bearer-токен; хранилище Go (JSON-файл и PostgreSQL) меняйте в обеих реализациях; мутации событий и задач учитывайте в офлайн-очереди (`src/api/outbox.ts`).
- Контракт API синхронизирован между `server/internal/model` и `src/domain/types.ts`.
- Внешние календари: запись событий — только через `*Synced`-функции в `server/internal/api/calendars.go`, внешние запросы — через `calsync.Net`, секреты — через `secret.Box`. Упоминания делят задачу только как новые (`newMentions`).
- Без `eslint-disable`, `!important` и `as any`; таймеры — `useTimeout`/`useInterval`, колбэки в эффектах — `useEffectEvent`.
- Стили — CSS Modules и токены из `src/styles/global.css`; модалки — `components/BottomSheet`.
- Перед завершением: `npm run check` и `cd server && go test ./...`.
