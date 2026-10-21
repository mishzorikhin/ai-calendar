import type {
  AppNotification,
  CalendarEvent,
  ChatMessage,
  CalDavCalendar,
  CalDavCredentials,
  DatedEvent,
  EventPatch,
  Integration,
  IntegrationPatch,
  IntegrationsInfo,
  MonthDots,
  NewEvent,
  NewIntegration,
  NewTask,
  Task,
  TaskPatch,
  User,
} from '../domain/types'

/** Сессия аккаунта: токен идёт в заголовок Authorization, user — для UI. */
export type Session = { token: string; user: User }

/**
 * Событие стрима чата: кусочек ответа, статус вызова инструмента, конец, ошибка.
 * Сервер сам сохраняет обе реплики в историю.
 */
export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; status: 'run' | 'done'; detail?: string; date?: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

/**
 * Источник данных приложения. Две реализации:
 * - `server` — Go-бэкенд (server/), данные за аккаунтом и хранятся на сервере;
 * - `local` — без сервера (GitHub Pages, превью): моки и localStorage этого браузера.
 */
export interface CalendarApi {
  readonly mode: 'server' | 'local'
  /** Все события дня: расписание и события пользователя — по времени начала. */
  getEvents(date: Date): Promise<CalendarEvent[]>
  createEvent(input: NewEvent): Promise<DatedEvent>
  updateEvent(id: string, patch: EventPatch): Promise<DatedEvent>
  deleteEvent(id: string): Promise<void>
  /** Месяц с 0, как в Date. */
  getMonthDots(year: number, month: number): Promise<MonthDots>
  /** Задачи и цели в порядке создания. */
  getTasks(): Promise<Task[]>
  createTask(input: NewTask): Promise<Task>
  updateTask(id: string, patch: TaskPatch): Promise<Task>
  deleteTask(id: string): Promise<void>
  getMessages(): Promise<ChatMessage[]>
  addMessage(role: ChatMessage['role'], text: string): Promise<ChatMessage>
  /** Сообщение ассистенту: ответ приходит потоком событий в onEvent. */
  sendChat(text: string, onEvent: (e: ChatEvent) => void): Promise<void>

  /** Профиль текущего пользователя. */
  me(): Promise<User>
  /** Переименовать себя (отображаемое имя). */
  updateMe(name: string): Promise<User>
  /** Вход и регистрация: сервер сохраняет сессию (токен) и возвращает её. */
  login(input: { username: string; password: string }): Promise<Session>
  register(input: { username: string; name?: string; password: string }): Promise<Session>
  logout(): Promise<void>
  /** Поиск людей для @упоминаний: пустой запрос — все пользователи кроме себя. */
  searchUsers(query: string): Promise<User[]>
  getNotifications(): Promise<AppNotification[]>
  /** Отметить все уведомления прочитанными. */
  markNotificationsRead(): Promise<void>
  /** Добавить участника общей задачи по логину. */
  addTaskMember(taskId: string, username: string): Promise<Task>
  /** Владелец удаляет участника, участник так выходит из задачи. */
  removeTaskMember(taskId: string, username: string): Promise<Task>
  /** Запомнить часовой пояс браузера — в нём сервер раскладывает внешние календари по дням. */
  setTimeZone(timeZone: string): Promise<User>

  /** Подключённые календари и доступные сервисы. */
  getIntegrations(): Promise<IntegrationsInfo>
  /** Календари на CalDAV-сервере (Яндекс, iCloud, Nextcloud) по логину и паролю приложения. */
  discoverCalDav(input: CalDavCredentials): Promise<CalDavCalendar[]>
  /** Подключить подписку .ics или CalDAV-календарь; сервер сразу загружает события. */
  createIntegration(input: NewIntegration): Promise<Integration>
  updateIntegration(id: string, patch: IntegrationPatch): Promise<Integration>
  /** Отключить календарь: его события пропадают из приложения. */
  deleteIntegration(id: string): Promise<void>
  /** Синхронизировать сейчас; ошибка сервиса — в lastError. */
  syncIntegration(id: string): Promise<Integration>
  /** Ссылка на страницу входа Google/Microsoft — браузер уходит туда сам. */
  startOAuth(provider: 'google' | 'outlook'): Promise<string>
  /** Ссылка на ленту .ics пользователя; null — лента выключена. */
  getFeed(): Promise<string | null>
  /** Включить ленту или выдать новую ссылку (старая перестаёт работать). */
  resetFeed(): Promise<string>
  disableFeed(): Promise<void>
}

/** Ошибка API с текстом, который можно показать пользователю. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Текст ошибки для пользователя: сырые ответы сервера («Метод API не найдено»)
 * заменяем понятными формулировками, осмысленные сообщения оставляем.
 */
export function apiErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'Нет соединения с сервером'
    if (err.status === 404) return 'Функция недоступна — сервер устарел'
    if (err.status >= 500) return 'Ошибка сервера — попробуйте позже'
    return err.message
  }
  return err instanceof Error ? err.message : 'Что-то пошло не так'
}

/** Клиентские 4xx не повторяем — они не «заживут сами», а спамят консоль и обманчиво выглядят. */
export function retryQuery(failureCount: number, err: unknown): boolean {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false
  return failureCount < 2
}
