# Инструкции для GitHub Copilot

Правила проекта описаны в [`AGENTS.md`](../AGENTS.md) (общие), [`server/AGENTS.md`](../server/AGENTS.md)
(бэкенд на Go) и [`REVIEW.md`](../REVIEW.md) (ревью). Следуйте им. Самое важное:

- Комментарии, тексты интерфейса и коммиты — на русском; идентификаторы — на английском.
- Данные во фронтенде — только через `src/api/queries.ts`; новый метод API реализуется и в `http.ts`, и в `local.ts`.
- Контракт API синхронизирован между `server/internal/model` и `src/domain/types.ts`.
- Без `eslint-disable`, `!important` и `as any`; таймеры — `useTimeout`/`useInterval`, колбэки в эффектах — `useEffectEvent`.
- Стили — CSS Modules и токены из `src/styles/global.css`; модалки — `components/BottomSheet`.
- Перед завершением: `npm run check` и `cd server && go test ./...`.
