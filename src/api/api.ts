import type {
  Alarm,
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
  Invite,
  Memory,
  MemoryKind,
  MemoryPatch,
  MonthDots,
  NewEvent,
  NewIntegration,
  NewTask,
  NotifySettings,
  Person,
  PersonInput,
  AuthSession,
  WeekInsights,
  Suggestion,
  Profile,
  ProfilePatch,
  PushDevice,
  PushInfo,
  PushSubscriptionData,
  Rsvp,
  SearchResult,
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
  /** Сервер принял сообщение и сохранил его (шлёт сам клиент API, а не поток): дальше ошибка — уже обрыв ответа. */
  | { type: 'open' }
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; status: 'run' | 'done'; detail?: string; date?: string }
  /** Что ассистент запомнил, поменял или забыл за этот ход (сервер шлёт перед done). */
  | { type: 'memory'; items: MemoryChange[] }
  /** Действие ждёт кнопки пользователя: удаление, перенос нескольких событий, освобождение дня. */
  | { type: 'confirm'; confirm: ChatConfirm }
  | { type: 'done' }
  | { type: 'error'; message: string }

/** Изменение памяти за ход: показывается под ответом («Запомнил: …»). */
export type MemoryChange = { action: 'added' | 'updated' | 'deleted'; text: string }

/**
 * Карточка подтверждения в чате. Ассистент только предлагает действие — выполняет его
 * сервер по кнопке. Карточка живёт до следующей реплики (и не дольше 10 минут).
 */
export type ChatConfirm = { id: string; title: string; detail?: string; button: string; date?: string }

/** Итог нажатия на карточке: реплика ассистента в истории и день, к которому это относилось. */
export type ChatConfirmResult = { message: ChatMessage; ok: boolean; date?: string }

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
  /** Ответ на приглашение на чужую встречу. */
  rsvpEvent(id: string, status: Rsvp): Promise<Invite>
  /** Месяц с 0, как в Date. */
  getMonthDots(year: number, month: number): Promise<MonthDots>
  /** Поиск по своим событиям (название, место, заметки) и задачам; запрос от 2 символов. */
  search(query: string): Promise<SearchResult>
  /** Задачи и цели в порядке создания. */
  getTasks(): Promise<Task[]>
  createTask(input: NewTask): Promise<Task>
  updateTask(id: string, patch: TaskPatch): Promise<Task>
  deleteTask(id: string): Promise<void>
  getMessages(): Promise<ChatMessage[]>
  /**
   * Сообщение ассистенту: ответ приходит потоком событий в onEvent. `signal` прерывает чтение
   * (ушли из чата) — сервер всё равно допишет ответ и сохранит его в истории.
   */
  /** image — картинка к реплике (data URL JPEG, до 1,5 МБ); в истории от неё остаётся пометка «📎 фото». */
  sendChat(text: string, onEvent: (e: ChatEvent) => void, signal?: AbortSignal, image?: string): Promise<void>
  /** Карточки подтверждения, которые ждут ответа. */
  getChatConfirms(): Promise<ChatConfirm[]>
  /** Ответ на карточку: accept — выполнить действие, иначе — отказаться. */
  decideChatConfirm(id: string, accept: boolean): Promise<ChatConfirmResult>

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

  /** Уведомления: ключ для подписки браузера, настройки напоминаний, сколько устройств подписано. */
  getPush(): Promise<PushInfo>
  /** Изменить настройки напоминаний (переданные поля). */
  updateNotifySettings(patch: Partial<NotifySettings>): Promise<NotifySettings>
  /** Сохранить подписку этого браузера за аккаунтом. */
  subscribePush(sub: PushSubscriptionData): Promise<void>
  /** Забыть подписку этого браузера. */
  unsubscribePush(endpoint: string): Promise<void>
  /** Прислать пробное уведомление; возвращает, на сколько устройств оно ушло. */
  testPush(): Promise<number>
  /** Устройства с уведомлениями и отключение одного из них. */
  getDevices(): Promise<PushDevice[]>
  deleteDevice(id: string): Promise<void>
  /** Свои напоминания без события и отложенные из уведомлений, ближайшие первыми. */
  getAlarms(): Promise<Alarm[]>
  createAlarm(input: { text: string; at: Date }): Promise<Alarm>
  deleteAlarm(id: number): Promise<void>

  /** Профиль: ритм дня, рабочее время, «святые» блоки, манера общения ассистента. */
  getProfile(): Promise<Profile>
  updateProfile(patch: ProfilePatch): Promise<Profile>
  /** Память ассистента: факты из разговоров и догадки (новые первыми, без отклонённых). */
  getMemories(): Promise<Memory[]>
  createMemory(input: { kind: MemoryKind; text: string; date?: string }): Promise<Memory>
  updateMemory(id: number, patch: MemoryPatch): Promise<Memory>
  deleteMemory(id: number): Promise<void>
  /** Забыть всё. */
  deleteAllMemories(): Promise<void>
  /** Карточки людей по имени. */
  getPeople(): Promise<Person[]>
  createPerson(input: PersonInput): Promise<Person>
  /** Заменить карточку целиком. */
  updatePerson(id: number, input: PersonInput): Promise<Person>
  deletePerson(id: number): Promise<void>
  /**
   * Предложения ассистента, ждущие ответа. «Да» выполняет действие на сервере (создаёт событие
   * или задачу; у chat — ничего, запрос отправляет клиент), «Нет» с mute выключает такой вид.
   * В локальном режиме предложений нет — их считает сервер.
   */
  /** Аккаунт (только сервер): устройства, пароль, выгрузка и удаление. */
  getSessions(): Promise<AuthSession[]>
  deleteSession(id: string): Promise<void>
  logoutOthers(): Promise<void>
  /** Остальные устройства выходят. */
  changePassword(current: string, next: string): Promise<void>
  /** Все свои данные одним JSON (текст файла). */
  exportData(): Promise<string>
  /** Удалить аккаунт со всеми данными; сессия этого устройства сбрасывается. */
  deleteAccount(password: string): Promise<void>
  /** Обзор недели, в которую входит start. */
  getWeekInsights(start: Date): Promise<WeekInsights>
  getSuggestions(): Promise<Suggestion[]>
  acceptSuggestion(id: number): Promise<Suggestion>
  dismissSuggestion(id: number, mute?: boolean): Promise<void>
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
