# AGENTS.md — инструкция для кодовых агентов

Этот файл — основной источник правил для любого агента (Claude Code, Codex, Cursor, Copilot и др.).
Человеческое описание проекта — в `README.md`; правила бэкенда — в `server/AGENTS.md`;
чек-лист ревью — в `REVIEW.md`.

## Что это за проект

Мобильный AI-календарь (PWA). Пользователь одной фразой просит ассистента что-то запланировать
(«завтрак с Глебом в уютном месте рядом»), ассистент находит свободное окно, подбирает место,
звонит в ресторан и сохраняет бронь в календарь.

- **Фронтенд** — React 19 + TypeScript (strict) + Vite 8 + framer-motion + CSS Modules + TanStack Query, PWA через vite-plugin-pwa.
- **Бэкенд** — Go 1.24, только стандартная библиотека (`server/`), хранение в JSON-файле.
- **Поставка** — один Docker-образ: Go-бинарник со встроенным UI (`go:embed`).
- **Ассистент пока заскриптован** (разбор запроса и звонок — демо), а события, брони и чат — настоящие данные на сервере.
- **Главное в продукте — дизайн и анимации.** Визуальное качество важнее количества функций.

## Язык

- Интерфейс, комментарии в коде, сообщения коммитов, документация — **на русском**.
- Идентификаторы (переменные, функции, типы, CSS-классы) — на английском.
- Тексты интерфейса — живые и короткие, без канцелярита; кавычки «ёлочки», тире «—», буква «ё».

## Команды

| Задача                                   | Команда                                                          |
| ---------------------------------------- | ---------------------------------------------------------------- |
| Установить зависимости                   | `npm ci` (Node 22)                                               |
| UI с горячей перезагрузкой               | `npm run dev` → http://localhost:5173                            |
| Go-сервер (API на :8080, UI из `dist/`)  | `make api`                                                       |
| **Все проверки фронтенда**               | `npm run check` (типы, ESLint, vitest, prettier --check)         |
| Только тесты / линтер / типы             | `npm run test` · `npm run lint` · `npm run typecheck`            |
| Форматирование                           | `npm run format`                                                 |
| Проверки бэкенда                         | `cd server && gofmt -l . && go vet ./... && go test -race ./...` |
| Всё сразу                                | `make check`                                                     |
| Сборка PWA                               | `npm run build` → `dist/`                                        |
| Однофайловая сборка (превью без сервера) | `npm run build:single` → `dist-single/index.html`                |
| Docker                                   | `docker compose up --build` → http://localhost:8080              |

Без запущенного Go-сервера UI сам переходит в **локальный режим** (моки + `localStorage`), поэтому
для работы над интерфейсом сервер не обязателен. Явно: `VITE_API_MODE=local|server`.

## Структура

```
src/
  api/        источник данных: api.ts (интерфейс), http.ts (Go-сервер), local.ts (браузер),
              connect.ts (выбор режима), queries.ts (хуки TanStack Query и ключи кэша)
  app/        состояние интерфейса — узкие контексты: navigation, calendar (выбранный день),
              assistant (запрос, черновик, голос), composer (шторка события), bar (нижняя панель)
  domain/     чистая логика без React: types.ts, calendar.ts (слоты), restaurants.ts, request.ts
  mocks/      демо-данные для локального режима и сценарий звонка
  lib/        dates, plural (Intl.PluralRules), hooks (useTimeout/useInterval/useNow), motion-пресеты
  components/ общие UI: ui.tsx (Pressable, Pill, CircleButton, Avatar…), BottomSheet, BottomBar, Icons
  pwa/        UpdatePrompt, OfflineBadge, InstallBanner, useLaunchAction (shortcuts)
  screens/    home, month, day, chat, agent — у каждого экрана своя папка
  styles/     global.css — дизайн-токены
server/       Go-бэкенд, см. server/AGENTS.md
public/       иконки PWA (PNG генерируются из icon.svg)
```

Правило зависимостей: `screens → components/app/api → domain/lib`. `domain/` и `lib/` не импортируют
React-компоненты; `mocks/` используются только в `api/local.ts` и как демо-контент (FRIEND, DEMO_PROMPT).

## Архитектурные правила

1. **Данные — только через `api/queries.ts`.** Не вызывайте `fetch` из компонентов и не импортируйте
   `mocks/calendar` в экраны. Новый эндпоинт = метод в `CalendarApi` (`api/api.ts`) +
   реализация в **обоих** `http.ts` и `local.ts` + хук в `queries.ts` + ключ в `keys` + инвалидация.
2. **Контракт API в двух местах:** Go `server/internal/model` ↔ TS `src/domain/types.ts`
   (+ DTO-преобразования в `api/http.ts`). Меняете поле — меняйте обе стороны и тесты обеих сторон.
3. **`local.ts` повторяет правила сервера** (валидация, номер брони, 409 для закрытого места), чтобы
   UI вёл себя одинаково в обоих режимах.
4. **Нижняя панель:** экран рендерит `<BarSlot id="…" hidden? aiActive?>…</BarSlot>` (портал).
   Не кладите JSX в глобальное состояние. `BarSlot` — на верхнем уровне экрана, не внутри
   вложенных `AnimatePresence`.
5. **Модальные окна — только через `components/BottomSheet`** (Escape, фокус-ловушка, `inert` фона,
   свайп вниз). Не копируйте разметку шторки.
6. **Сценарий ассистента** — редьюсер `screens/agent/useAgentFlow.ts` с дискриминированным union
   шагов. Новое поведение — новое действие в редьюсере + тест в `useAgentFlow.test.ts`.
   Данные шага живут внутри шага (например, время брони фиксируется в `flow.time` при звонке).
7. **Доменная логика — чистые функции в `domain/`** с тестами рядом (`*.test.ts`).
8. **Даты:** в состоянии — `Date` начала суток (`startOfDay`), в API — строка `ГГГГ-ММ-ДД`
   (`toISODate`/`fromISODate`). Время внутри дня — минуты от полуночи (`number`).
9. **Склонения и подписи дней** — `lib/plural.ts` и `relativeDayLabel` из `lib/dates.ts`; не пишите
   свои `n % 10`. Имена в падежах — поля `Person` (`nameAccusative`, `nameDative`).

## React и TypeScript

- Строгий TS: `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. Индексация массивов даёт
  `T | undefined` — обрабатывайте, не глушите `!`.
- Типы импортируются как `import type` / `type X` (ESLint `consistent-type-imports`).
- ESLint с правилами React Compiler (`react-hooks` recommended-latest) и `jsx-a11y`.
  **`eslint-disable` запрещены.** Если линтер ругается на эффект — правильный инструмент почти всегда:
  - колбэк из пропсов внутри эффекта → `useEffectEvent`;
  - таймеры → `useTimeout` / `useInterval` из `lib/hooks.ts` (сами снимаются при размонтировании);
  - «текущее время» → `useNow()`;
  - производное состояние → вычислять в рендере или сбрасывать через `key`, а не `setState` в эффекте;
  - DOM-измерения/прокрутка до отрисовки → `useLayoutEffect`.
- Контекст: `use(Context)` и `<Context value>` (React 19). Каждый контекст узкий и мемоизирован.
- Компонент > ~150 строк или с несколькими независимыми частями — разбейте на файлы в папке экрана.
- `key={index}` допустим только для статичных или только растущих списков.

## Стили и дизайн

- **CSS Modules** рядом с компонентом. Цвета, радиусы, тени, слои — **токены** из
  `src/styles/global.css` (`--ink`, `--ink-2`, `--surface`, `--r-xl`, `--shadow-md`, `--z-sheet`…).
  Новые цвета — сначала токен.
- Не используйте `!important`. Чтобы перебить стили примитива, повышайте специфичность
  (`.parent .child`) или добавьте проп в примитив.
- Контраст: основной текст ≥ 4.5:1 (`--ink-2` проверен), крупный второстепенный — `--ink-soft` (≥ 3:1).
- Зоны нажатия ≥ 44 px (`Pill small` = 40 px — минимум для второстепенных действий).
- Мобильная вёрстка первична: проверяйте 390×844 и 375×667 (iPhone SE). Учитывайте
  `--safe-top`/`--safe-bottom`/`--bar-h` — на десктопе они переопределяются рамкой телефона.
- Шрифт — Inter Variable (локально); заголовки — классы `display`/`title`, `tnum` для цифр.

## Анимации (framer-motion)

- Пресеты — `lib/motion.ts` (`spring`, `softSpring`, `bouncy`, `screenVariants`, `itemVariants`).
- Бесконечные анимации отключайте при `useReducedMotion()`; `MotionConfig reducedMotion="user"`
  гасит только transform/layout, не opacity/цвет.
- Не анимируйте `filter: blur()` на множестве элементов (дорого на iOS) — только opacity/transform.
- framer-motion управляет `transform`: не центрируйте анимируемый элемент через
  `transform: translate(-50%)` в CSS — используйте `left:0; right:0; margin:auto; width:fit-content`.
- Дочерние компоненты `AnimatePresence mode="popLayout"` должны принимать `ref` и передавать его
  в корневой `motion`-элемент (React 19: `ref` — обычный проп).
- Для layout-анимаций задавайте `borderRadius` в `style`, чтобы скругления не искажались.

## Доступность

- Иконочные кнопки — `aria-label`; переключатели — `aria-pressed` / `role="switch"` / `radiogroup`.
- Скрытые панели — `inert` + `aria-hidden`. Шторки — `BottomSheet` (`aria-modal`, фокус, Escape).
- Живые статусы — `aria-live="polite"` или `role="status"`.

## PWA

- Конфигурация — `vite.config.ts` (`VitePWA`): манифест, иконки, shortcuts, Workbox runtime caching.
- В режиме `--mode single` плагина PWA нет: `virtual:pwa-register/react` подменяется
  `src/pwa/registerStub.ts`.
- Новые запросы к API кэшируются NetworkFirst автоматически (кроме `/api/health`).
- Иконки PNG генерируются из `public/icon.svg` (размеры 192, 512, maskable 512, apple-touch 180).

## Как проверить свою работу (Definition of Done)

1. `npm run check` — зелёный.
2. Если трогали `server/` — `cd server && gofmt -l . && go vet ./... && go test -race ./...`.
3. `npm run build` проходит без предупреждений о размере чанков.
4. **Визуальная проверка UI-изменений:** запустите `npm run dev` и откройте экран в браузере на
   390×844 (и 375×667, если менялась вёрстка). Пройдите сценарий руками или через Playwright.
   Консоль браузера без ошибок. Для Docker/сервера — `docker compose up --build` и сценарий на :8080.
5. Новая логика покрыта тестом (`domain/`, `api/`, редьюсер ассистента, Go-хендлеры).
6. README обновлён, если поменялись команды, API или поведение для пользователя.

## Git

- Коммиты — на русском: заголовок до ~72 символов в повелительном/назывном стиле
  («Бронь сохраняется на сервере…»), затем пустая строка и тело списком по областям.
- Не коммитьте `dist/`, `dist-single/`, `server/data/`, содержимое `server/web/dist/` (кроме README).
- Перед коммитом — `npm run check`. Не переписывайте историю опубликованных веток.

## Известные подводные камни

- **Docker Hub rate limit:** при ошибке 429 используйте зеркало:
  `--build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-alpine --build-arg GO_IMAGE=mirror.gcr.io/library/golang:1.24-alpine`.
- **Сеть в песочнице с TLS-прокси:** `npm ci` внутри `docker build` падает на сертификате. Для локальной
  проверки соберите со своей CA во временной копии Dockerfile (не меняйте основной).
- Фото с `images.unsplash.com` могут быть недоступны — `SmartImage` показывает градиентную заглушку,
  это ожидаемо.
- Vite dev-сервер проксирует `/api` на `:8080`; без сервера в консоли будут 502 на `/api/health` —
  это нормально, приложение уйдёт в локальный режим.
- После брони свободные окна пересчитываются — время брони берите из `flow.time`/ответа сервера,
  а не из текущего `slot`.
