import type { ChatMessage, DatedEvent, Task, User } from '../domain/types'
import { isValidRange, messageError, subtitleError, titleError } from '../domain/limits'
import { fromISODate, toISODate } from '../lib/dates'
import { eventsFor, monthDotsFor } from '../mocks/calendar'
import { ApiError, type CalendarApi } from './api'

const STORAGE_KEY = 'ai-calendar:data:v1'

type Stored<T extends { date: Date }> = Omit<T, 'date'> & { date: string; createdAt?: string }

type Snapshot = {
  events: Stored<DatedEvent>[]
  messages: ChatMessage[]
  tasks: Task[]
  nextId: number
}

/** Первая ошибка проверки или null; отвечает так же, как сервер (400). */
const invalid = (...errors: (string | null)[]) => {
  const message = errors.find((e) => e !== null)
  return message ? Promise.reject(new ApiError(400, message)) : null
}

const GREETING: ChatMessage = { id: 0, role: 'ai', text: 'Чем могу помочь?' }

// Локальный режим — один «пользователь» без пароля; общие задачи недоступны.
const LOCAL_USER: User = { id: 0, username: 'local', name: 'Локальный режим' }
const NO_ACCOUNTS = new ApiError(400, 'Аккаунты и общие задачи работают только с сервером')
const NO_CALENDARS = new ApiError(400, 'Подключение календарей работает только с сервером')

function emptySnapshot(): Snapshot {
  return { events: [], messages: [GREETING], tasks: [], nextId: 3 }
}

function load(storage: Storage | null): Snapshot {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    return raw ? { ...emptySnapshot(), ...(JSON.parse(raw) as Partial<Snapshot>) } : emptySnapshot()
  } catch {
    return emptySnapshot()
  }
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Работа без сервера: моки + данные пользователя в localStorage этого браузера.
 * Повторяет правила сервера (проверки, id), чтобы UI вёл себя одинаково.
 */
export function createLocalApi(storage: Storage | null = safeStorage()): CalendarApi {
  let data = load(storage)

  const save = () => {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      /* хранилище недоступно — данные живут до перезагрузки */
    }
  }
  const HIGHLIGHT_MS = 24 * 60 * 60 * 1000
  const events = (): DatedEvent[] =>
    data.events.map(({ createdAt, highlight, ...e }) => ({
      ...e,
      // «Новое» живёт сутки, как на сервере.
      highlight: highlight !== false && createdAt !== undefined && Date.now() - Date.parse(createdAt) < HIGHLIGHT_MS,
      date: fromISODate(e.date),
    }))
  const nextId = (prefix: string) => `${prefix}-${data.nextId++}`
  // Имитируем сеть: ответ асинхронный, как у сервера.
  const reply = <T>(value: T) => Promise.resolve(value)

  return {
    mode: 'local',
    getEvents: (date) => reply(eventsFor(date, events())),
    createEvent(input) {
      const title = input.title.trim()
      const subtitle = input.subtitle?.trim()
      const bad =
        invalid(titleError(title), subtitleError(subtitle)) ??
        (isValidRange(input.start, input.end) ? null : invalid('Время задано неверно'))
      if (bad) return bad
      const event: DatedEvent = {
        id: nextId('evt'),
        title,
        subtitle,
        start: input.start,
        end: input.end,
        badge: input.badge ?? 'routine',
        highlight: true,
        date: input.date,
      }
      data.events.push({ ...event, date: toISODate(event.date), createdAt: new Date().toISOString() })
      save()
      return reply(event)
    },
    updateEvent(id, patch) {
      const i = data.events.findIndex((e) => e.id === id)
      if (i < 0) return Promise.reject(new ApiError(404, 'Событие не найдено'))
      const prev = data.events[i]!
      const title = patch.title?.trim()
      const subtitle = patch.subtitle?.trim()
      const next = {
        ...prev,
        title: title ?? prev.title,
        subtitle: subtitle ?? prev.subtitle,
        start: patch.start ?? prev.start,
        end: patch.end ?? prev.end,
        badge: patch.badge ?? prev.badge,
        date: patch.date ? toISODate(patch.date) : prev.date,
      }
      const bad =
        invalid(title === undefined ? null : titleError(title), subtitleError(subtitle)) ??
        (isValidRange(next.start, next.end) ? null : invalid('Время задано неверно'))
      if (bad) return bad
      data.events[i] = next
      save()
      return reply({ ...next, date: fromISODate(next.date) })
    },
    deleteEvent(id) {
      const before = data.events.length
      data.events = data.events.filter((e) => e.id !== id)
      if (data.events.length === before) return Promise.reject(new ApiError(404, 'Событие не найдено'))
      save()
      return reply(undefined)
    },
    getMonthDots: (year, month) => reply(monthDotsFor(year, month, events())),
    getTasks: () => reply([...data.tasks]),
    createTask(input) {
      const title = input.title.trim()
      const subtitle = input.subtitle?.trim()
      const bad = invalid(titleError(title), subtitleError(subtitle))
      if (bad) return bad
      const task: Task = {
        id: nextId('task'),
        title,
        subtitle,
        kind: input.kind ?? 'task',
        category: input.category,
        done: false,
        due: input.due,
      }
      data.tasks.push(task)
      save()
      return reply(task)
    },
    updateTask(id, patch) {
      const i = data.tasks.findIndex((t) => t.id === id)
      if (i < 0) return Promise.reject(new ApiError(404, 'Задача не найдена'))
      const prev = data.tasks[i]!
      const title = patch.title?.trim()
      const subtitle = patch.subtitle?.trim()
      const bad = invalid(title === undefined ? null : titleError(title), subtitleError(subtitle))
      if (bad) return bad
      const task: Task = {
        ...prev,
        title: title ?? prev.title,
        subtitle: subtitle ?? prev.subtitle,
        kind: patch.kind ?? prev.kind,
        done: patch.done ?? prev.done,
        due: patch.due ?? prev.due,
      }
      // '' очищает категорию; undefined — не трогает.
      if (patch.category !== undefined) task.category = patch.category || undefined
      data.tasks[i] = task
      save()
      return reply(task)
    },
    deleteTask(id) {
      const before = data.tasks.length
      data.tasks = data.tasks.filter((t) => t.id !== id)
      if (data.tasks.length === before) return Promise.reject(new ApiError(404, 'Задача не найдена'))
      save()
      return reply(undefined)
    },
    getMessages: () => reply([...data.messages]),
    addMessage(role, text) {
      const bad = invalid(messageError(text.trim()))
      if (bad) return bad
      const message: ChatMessage = { id: (data.messages.at(-1)?.id ?? 0) + 1, role, text: text.trim() }
      data = { ...data, messages: [...data.messages, message] }
      save()
      return reply(message)
    },
    // Без сервера модели нет — честно об этом говорим и сохраняем обе реплики.
    async sendChat(text, onEvent) {
      const bad = invalid(messageError(text.trim()))
      if (bad) return bad
      const answer = 'Ассистент отвечает только с сервером — запустите `make api` с переменной LLM_API_KEY.'
      const user: ChatMessage = { id: (data.messages.at(-1)?.id ?? 0) + 1, role: 'user', text: text.trim() }
      const ai: ChatMessage = { id: user.id + 1, role: 'ai', text: answer }
      data = { ...data, messages: [...data.messages, user, ai] }
      save()
      onEvent({ type: 'delta', text: answer })
      onEvent({ type: 'done' })
    },

    me: () => reply({ ...LOCAL_USER }),
    updateMe: (name) => reply({ ...LOCAL_USER, name }),
    login: () => Promise.reject(NO_ACCOUNTS),
    register: () => Promise.reject(NO_ACCOUNTS),
    logout: () => reply(undefined),
    searchUsers: () => reply([]),
    getNotifications: () => reply([]),
    markNotificationsRead: () => reply(undefined),
    addTaskMember: () => Promise.reject(NO_ACCOUNTS),
    removeTaskMember: () => Promise.reject(NO_ACCOUNTS),
    setTimeZone: (timeZone) => reply({ ...LOCAL_USER, timeZone }),

    // Внешних календарей без сервера нет: список пуст, подключение — с понятной ошибкой.
    getIntegrations: () => reply({ items: [], providers: { google: false, outlook: false } }),
    discoverCalDav: () => Promise.reject(NO_CALENDARS),
    createIntegration: () => Promise.reject(NO_CALENDARS),
    updateIntegration: () => Promise.reject(NO_CALENDARS),
    deleteIntegration: () => Promise.reject(NO_CALENDARS),
    syncIntegration: () => Promise.reject(NO_CALENDARS),
    startOAuth: () => Promise.reject(NO_CALENDARS),
    getFeed: () => reply(null),
    resetFeed: () => Promise.reject(NO_CALENDARS),
    disableFeed: () => reply(undefined),
  }
}
