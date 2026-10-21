import type { ChatMessage, DatedEvent, NotifySettings, Task, User } from '../domain/types'
import {
  isValidRange,
  messageError,
  normalizeReminders,
  remindersError,
  subtitleError,
  titleError,
} from '../domain/limits'
import { DEFAULT_NOTIFY_SETTINGS } from '../domain/reminders'
import { isRepeat, occursOn, shiftSeries } from '../domain/repeat'
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
  /** Настройки напоминаний: без сервера уведомлений нет, но выбор «по умолчанию» в редакторе тот же. */
  notify?: NotifySettings
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
const NO_PUSH = new ApiError(400, 'Уведомления работают только с сервером')
const BADGES = ['sleep', 'routine', 'work', 'food', 'sport', 'read'] as const

/** Проверка повтора — те же правила, что на сервере (validateRepeat). */
function repeatError(repeat: unknown, until: string | undefined, date: string): string | null {
  if (repeat !== undefined && repeat !== '' && !isRepeat(repeat)) return `Неизвестный повтор: «${String(repeat)}»`
  if (!until) return null
  if (!repeat) return 'Дата окончания нужна только повторяющемуся событию'
  return until < date ? 'Повтор не может закончиться раньше первого дня' : null
}

/** Проверка настроек напоминаний — те же границы, что на сервере. */
function notifySettingsError(patch: Partial<NotifySettings>): string | null {
  const { eventReminder, taskTime, digest } = patch
  const badReminder = (v: number) => v !== -1 && remindersError([v]) !== null
  if (eventReminder !== undefined && badReminder(eventReminder))
    return 'Напоминание о событии — от 0 до 10080 минут или -1'
  for (const [badge, v] of Object.entries(patch.badgeReminders ?? {})) {
    if (!BADGES.some((b) => b === badge)) return `Неизвестный тип события: «${badge}»`
    if (v === undefined || badReminder(v)) return 'Напоминание о событии — от 0 до 10080 минут или -1'
  }
  for (const v of [taskTime, digest, patch.evening, patch.quietFrom, patch.quietTo]) {
    if (v !== undefined && v !== -1 && !(Number.isInteger(v) && v >= 0 && v < 1440))
      return 'Время — минуты от полуночи (0–1439) или -1'
  }
  return null
}

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
  /** События дня с развёрнутыми повторами — как eventsBetween на сервере. */
  const eventsOn = (day: string): DatedEvent[] =>
    events().flatMap((e) => {
      const iso = toISODate(e.date)
      if (!e.repeat) return iso === day ? [e] : []
      if (!occursOn({ ...e, date: iso, repeat: e.repeat }, day)) return []
      // «Новое» — только у первого вхождения.
      return [{ ...e, date: fromISODate(day), highlight: e.highlight && iso === day }]
    })
  const monthEvents = (year: number, month: number): DatedEvent[] => {
    const days = new Date(year, month + 1, 0).getDate()
    return Array.from({ length: days }, (_, i) => eventsOn(toISODate(new Date(year, month, i + 1)))).flat()
  }
  const nextId = (prefix: string) => `${prefix}-${data.nextId++}`
  // Имитируем сеть: ответ асинхронный, как у сервера.
  const reply = <T>(value: T) => Promise.resolve(value)

  return {
    mode: 'local',
    getEvents: (date) => reply(eventsFor(date, eventsOn(toISODate(date)))),
    createEvent(input) {
      const title = input.title.trim()
      const subtitle = input.subtitle?.trim()
      const bad =
        invalid(
          titleError(title),
          subtitleError(subtitle),
          remindersError(input.reminders),
          repeatError(input.repeat, input.repeatUntil, toISODate(input.date)),
        ) ?? (isValidRange(input.start, input.end) ? null : invalid('Время задано неверно'))
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
        reminders: input.reminders ? normalizeReminders(input.reminders) : null,
        repeat: input.repeat,
        repeatUntil: input.repeat ? input.repeatUntil || undefined : undefined,
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
      if (patch.skip && !prev.repeat) return invalid('Убрать один день можно только из повторяющегося события')!
      // Перенос одного вхождения серии сдвигает всю серию.
      const date =
        patch.date && patch.occurrence && prev.repeat
          ? shiftSeries(prev.date, patch.occurrence, patch.date)
          : patch.date
            ? toISODate(patch.date)
            : prev.date
      const repeat = patch.repeat === undefined ? prev.repeat : patch.repeat || undefined
      const skip = patch.skip && toISODate(patch.skip)
      const next = {
        ...prev,
        title: title ?? prev.title,
        subtitle: subtitle ?? prev.subtitle,
        start: patch.start ?? prev.start,
        end: patch.end ?? prev.end,
        badge: patch.badge ?? prev.badge,
        date,
        // undefined — не трогаем, null — по умолчанию, [] — без напоминаний.
        reminders:
          patch.reminders === undefined ? prev.reminders : patch.reminders && normalizeReminders(patch.reminders),
        repeat,
        // Снятый повтор забирает с собой дату окончания и убранные дни.
        repeatUntil: !repeat
          ? undefined
          : patch.repeatUntil === undefined
            ? prev.repeatUntil
            : patch.repeatUntil || undefined,
        exdates: !repeat
          ? undefined
          : skip && !prev.exdates?.includes(skip)
            ? [...(prev.exdates ?? []), skip]
            : prev.exdates,
      }
      const bad =
        invalid(
          title === undefined ? null : titleError(title),
          subtitleError(subtitle),
          remindersError(patch.reminders),
          repeatError(next.repeat, next.repeatUntil, next.date),
        ) ?? (isValidRange(next.start, next.end) ? null : invalid('Время задано неверно'))
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
    getMonthDots: (year, month) => reply(monthDotsFor(year, month, monthEvents(year, month))),
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
    // Без сервера модели нет — честно об этом говорим и сохраняем обе реплики.
    async sendChat(text, onEvent) {
      const bad = invalid(messageError(text.trim()))
      if (bad) return bad
      const answer = 'Ассистент отвечает только с сервером — запустите `make api` с переменной LLM_API_KEY.'
      const user: ChatMessage = { id: (data.messages.at(-1)?.id ?? 0) + 1, role: 'user', text: text.trim() }
      const ai: ChatMessage = { id: user.id + 1, role: 'ai', text: answer }
      data = { ...data, messages: [...data.messages, user, ai] }
      save()
      onEvent({ type: 'open' })
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

    // Без сервера некому слать уведомления: настройки храним, подписаться нельзя.
    getPush: () => reply({ publicKey: null, settings: data.notify ?? DEFAULT_NOTIFY_SETTINGS, devices: 0 }),
    updateNotifySettings(patch) {
      const bad = invalid(notifySettingsError(patch))
      if (bad) return bad
      data.notify = { ...(data.notify ?? DEFAULT_NOTIFY_SETTINGS), ...patch }
      save()
      return reply(data.notify)
    },
    subscribePush: () => Promise.reject(NO_PUSH),
    unsubscribePush: () => reply(undefined),
    testPush: () => Promise.reject(NO_PUSH),
    getDevices: () => reply([]),
    deleteDevice: () => Promise.reject(NO_PUSH),
    getAlarms: () => reply([]),
    createAlarm: () => Promise.reject(NO_PUSH),
    deleteAlarm: () => Promise.reject(NO_PUSH),
  }
}
