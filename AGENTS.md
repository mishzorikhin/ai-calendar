# AGENTS.md — инструкция для кодовых агентов

Этот файл — основной источник правил для любого агента (Claude Code, Codex, Cursor, Copilot и др.).
Человеческое описание проекта — в `README.md`; правила бэкенда — в `server/AGENTS.md`;
чек-лист ревью — в `REVIEW.md`.

## Что это за проект

Мобильный AI-календарь (PWA). Пользователь пишет или диктует ассистенту («поставь встречу с Глебом
на завтра после обеда»), а тот через инструменты смотрит расписание, ищет свободные окна и
создаёт, меняет и удаляет события и задачи.

- **Фронтенд** — React 19 + TypeScript (strict) + Vite 8 + framer-motion + CSS Modules + TanStack Query, PWA (свой service worker `src/sw.ts`, Workbox через `injectManifest`).
- **Бэкенд** — Go 1.24 (`server/`): стандартная библиотека + `pgx/v5` для PostgreSQL. Хранилище — JSON-файл или PostgreSQL (если задан `DATABASE_URL`).
- **Аккаунты** — регистрация и вход по логину и паролю, Bearer-токен. События и чат личные; **задачи и цели** можно делить с другими (`@логин` в тексте или список участников), участники получают уведомления.
- **Ассистент** — настоящий LLM с function calling (OpenAI-совместимый API, SSE-стрим), `server/internal/llm` + `POST /api/chat`. Без `LLM_API_KEY` отвечает заглушкой.
- **Офлайн** — мутации событий и задач при обрыве сети ждут в очереди (`api/outbox.ts`, IndexedDB) и доигрываются сами.
- **Внешние календари** — Google и Outlook (OAuth), CalDAV (Яндекс, iCloud, Nextcloud), подписки `.ics` и своя лента `.ics`
  наружу (`server/internal/calsync`, UI — `screens/home/calendars`). Их события лежат рядом со своими (`source`).
- **Два режима данных:** серверный и локальный (моки + `localStorage`, без аккаунта — для GitHub Pages и работы над UI).
- **Поставка** — один Docker-образ: Go-бинарник со встроенным UI (`go:embed`); `docker-compose` поднимает ещё и PostgreSQL 17.
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
| Docker (приложение + PostgreSQL)         | `docker compose up --build` → http://localhost:8080              |
| Тест PostgreSQL-хранилища                | `TEST_DATABASE_URL=postgres://… go test ./internal/store`        |

Без запущенного Go-сервера UI сам переходит в **локальный режим** (моки + `localStorage`, без входа),
поэтому для работы над интерфейсом сервер не обязателен. Явно: `VITE_API_MODE=local|server`,
адрес бэкенда на другом домене — `VITE_API_URL`. Если приложение уже работало с сервером, а сеть
пропала, оно остаётся в серверном режиме (кэш + офлайн-очередь), а не откатывается к моками.
Без `LLM_API_KEY` чат отвечает заглушкой; в `make api` ключ можно передать через окружение.

## Структура

```
src/
  api/        источник данных: api.ts (интерфейс CalendarApi), http.ts (Go-сервер), local.ts (браузер),
              connect.ts (выбор режима), offline.ts + outbox.ts (офлайн-очередь мутаций, IndexedDB),
              session.ts (токен и пользователь в localStorage), provider.tsx, queries.ts (хуки TanStack Query и ключи кэша)
  app/        состояние интерфейса — узкие контексты: navigation, calendar (выбранный день),
              assistant (запрос, голос), composer (шторка события), bar (нижняя панель), session-gate (вход)
  domain/     чистая логика без React: types.ts, calendar.ts (слоты), limits.ts (лимиты и валидация)
  mocks/      демо-данные локального режима (calendar.ts) и подсказки чата (assistant.ts)
  lib/        dates, plural (Intl.PluralRules), hooks (useTimeout/useInterval/useNow), motion-пресеты,
              speech (Web Speech API), storage, badges, sheetDrag
  components/ общие UI: ui.tsx (Pressable, Pill, CircleButton, Avatar…), BottomSheet, BottomBar,
              EventComposer, ReadOnlyEvent, VoiceOverlay, Icons
  pwa/        UpdatePrompt, OfflineBadge, InstallBanner, useLaunchAction (shortcuts), useOutboxSync
  screens/    auth, home (задачи и цели, аккаунт, calendars/ — шторка «Календари»), month, day, chat —
              у каждого экрана своя папка
  styles/     global.css — дизайн-токены
  sw.ts       service worker (precache, runtime-кэш API, Background Sync очереди)
server/       Go-бэкенд, см. server/AGENTS.md
public/       иконки PWA (PNG генерируются из icon.svg)
.ux-audit/    скриншоты и FINDINGS.md прошлого UX-аудита (справочно, не обновляется автоматически)
```

Правило зависимостей: `screens → components/app/api → domain/lib`. `domain/` и `lib/` не импортируют
React-компоненты; `mocks/` используются только в `api/local.ts` и как контент подсказок чата.

## Архитектурные правила

1. **Данные — только через `api/queries.ts`.** Не вызывайте `fetch` из компонентов и не импортируйте
   `mocks/calendar` в экраны. Новый эндпоинт = метод в `CalendarApi` (`api/api.ts`) +
   реализация в **обоих** `http.ts` и `local.ts` + хук в `queries.ts` + ключ в `keys` + инвалидация.
   Если это мутация событий или задач — решите, как она ведёт себя офлайн (`offline.ts`/`outbox.ts`:
   операция в очереди, временный id `offline-*`, склейка правок, `dedupe` для create), и добавьте тест.
2. **Контракт API в двух местах:** Go `server/internal/model` ↔ TS `src/domain/types.ts`
   (+ DTO-преобразования в `api/http.ts`). Меняете поле — меняйте обе стороны и тесты обеих сторон.
   Лимиты длин — `domain/limits.ts` ↔ `server/internal/api/api.go`. Месяц в TS и в `CalendarApi` —
   с 0 (как `Date`), в `/api/month` — с 1.
3. **`local.ts` повторяет правила сервера** (валидация, лимиты), чтобы UI вёл себя одинаково в обоих
   режимах. Исключение: аккаунтов в локальном режиме нет, шаринг задач и уведомления там заглушены.
4. **Сессия:** токен и пользователь лежат в `api/session.ts` (localStorage, общая для вкладок);
   `401` от сервера сбрасывает сессию и возвращает на экран входа (`app/session-gate`). Токен дублируется
   в метаданные outbox — его читает service worker. Не храните токен в других местах и не логируйте его.
5. **Нижняя панель:** экран рендерит `<BarSlot id="…" hidden? aiActive?>…</BarSlot>` (портал).
   Не кладите JSX в глобальное состояние. `BarSlot` — на верхнем уровне экрана, не внутри
   вложенных `AnimatePresence`.
6. **Модальные окна — только через `components/BottomSheet`** (Escape, фокус-ловушка, `inert` фона,
   свайп вниз за любое место). Не копируйте разметку шторки.
7. **События внешних календарей** — `CalendarEvent.source` (id подключения), `readOnly`, `allDay`.
   `useDayEvents` отдаёт события со временем в `events`, а на весь день — отдельно в `allDay`: шкала, окна
   и «Далее» их не учитывают. `readOnly` открывается в `ReadOnlyEvent`, а не в редакторе. Подключения —
   хуки `useIntegrations`/`useCreateIntegration`… в `queries.ts`; после их изменений инвалидируются и дни,
   и месяцы. Новый вид календаря — сначала провайдер в `server/internal/calsync`, затем вариант в
   `ConnectOptions`. В локальном режиме календари не подключаются (как и аккаунты).
8. **Чат** — `screens/chat`: ответ приходит потоком `ChatEvent` (`delta`/`tool`/`done`/`error`) через
   `CalendarApi.sendChat`; реплики сохраняет сервер. Поток в офлайн-очередь **не** кладётся — у него свой
   UI ошибки и повтора. После вызова инструмента инвалидируйте кэш событий/задач.
9. **Доменная логика — чистые функции в `domain/`** с тестами рядом (`*.test.ts`).
10. **Даты:** в состоянии — `Date` начала суток (`startOfDay`), в API — строка `ГГГГ-ММ-ДД`
    (`toISODate`/`fromISODate`). Время внутри дня — минуты от полуночи (`number`).
11. **Склонения и подписи дней** — `lib/plural.ts` и `relativeDayLabel` из `lib/dates.ts`; не пишите
    свои `n % 10`.

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
   Консоль браузера без ошибок. Для серверного режима — `make api` + `npm run dev` (нужна регистрация),
   для Docker — `docker compose up --build` и сценарий на :8080.
5. Новая логика покрыта тестом (`domain/`, `lib/`, `api/` — `http`/`local`/`offline`/`outbox`, Go-хендлеры,
   хранилище, `llm`).
6. README обновлён, если поменялись команды, API или поведение для пользователя.

## Git

- Коммиты — на русском: заголовок до ~72 символов в повелительном/назывном стиле
  («Бронь сохраняется на сервере…»), затем пустая строка и тело списком по областям.
- Не коммитьте `dist/`, `dist-single/`, `server/data/`, `.env`, содержимое `server/web/dist/` (кроме README).
- CI (`.github/workflows/ci.yml`) гоняет те же проверки, что Definition of Done, плюс сборку Docker;
  `deploy.yml` публикует статическую версию на GitHub Pages при пуше в `main`.
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
- Service worker и офлайн-очередь работают только на собранной версии (`npm run build` + `preview`
  или Docker), в `npm run dev` проверять их бессмысленно.
- Деплой на домашний сервер (rsync + `docker compose up -d --build`, порт из `APP_PORT`) описан в README;
  `.env` на сервере не трогайте — там `LLM_API_KEY`. Не выполняйте деплой без явной просьбы.
