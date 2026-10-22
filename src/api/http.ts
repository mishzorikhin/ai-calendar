import type {
  Alarm,
  AppNotification,
  Badge,
  CalDavCalendar,
  CalendarEvent,
  ChatMessage,
  DatedEvent,
  Integration,
  IntegrationsInfo,
  Invite,
  Memory,
  NotifySettings,
  Person,
  AuthSession,
  Suggestion,
  Profile,
  PushDevice,
  PushInfo,
  Task,
  User,
} from '../domain/types'
import { fromISODate, toISODate } from '../lib/dates'
import { ApiError, type CalendarApi, type ChatEvent, type Session } from './api'
import { setCredentialsGetter } from './outbox'
import { getSession, setSession } from './session'

// Офлайн-очередь повторяет запросы тем же токеном, что и обычные вызовы, и только операции этого пользователя.
setCredentialsGetter(() => {
  const s = getSession()
  return s && { token: s.token, userId: String(s.user.id) }
})

// Форматы ответов сервера (server/internal/model).
// externalId/etag/userId/createdAt — служебные поля сервера, в интерфейс их не тащим.
type EventDTO = CalendarEvent & {
  date: string
  externalId?: string
  etag?: string
  userId?: number
  createdAt?: string
}

const toEvent = ({ date, externalId: _x, etag: _e, userId: _u, createdAt: _c, ...e }: EventDTO): DatedEvent => ({
  ...e,
  date: fromISODate(date),
})

/** Абсолютная ссылка на путь API: лента .ics открывается в других приложениях. */
function absolute(baseUrl: string, path: string): string {
  // В тестах (node) адреса страницы нет — достраиваем от localhost.
  return new URL(baseUrl + path, globalThis.location?.href ?? 'http://localhost/').toString()
}

// Заголовки запроса: Bearer-сессия + JSON-тело, когда оно есть.
function headers(init?: RequestInit): HeadersInit | undefined {
  const token = getSession()?.token
  const out: Record<string, string> = {}
  if (init?.body) out['Content-Type'] = 'application/json'
  if (token) out['Authorization'] = `Bearer ${token}`
  return Object.keys(out).length > 0 ? out : undefined
}

export function createHttpApi(baseUrl = ''): CalendarApi {
  /** Запрос с сессией: сеть недоступна — ApiError(0), ответ не 2xx — ApiError с текстом сервера. */
  async function send(path: string, init?: RequestInit): Promise<Response> {
    let res: Response
    try {
      res = await fetch(baseUrl + path, { ...init, headers: headers(init) })
    } catch {
      throw new ApiError(0, 'Нет соединения с сервером')
    }
    // Сессия протухла или удалена на сервере — возвращаемся на экран входа.
    if (res.status === 401 && getSession()) setSession(null)
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null)
      throw new ApiError(res.status, errorMessage(body, res.status))
    }
    return res
  }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await send(path, init)
    if (res.status === 204) return undefined as T
    return (await res.json().catch(() => null)) as T
  }

  const post = <T>(path: string, data: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(data) })

  return {
    mode: 'server',
    async getEvents(date) {
      const list = await request<EventDTO[]>(`/api/events?date=${toISODate(date)}`)
      return list.map(toEvent)
    },
    async createEvent(input) {
      return toEvent(await post<EventDTO>('/api/events', { ...input, date: toISODate(input.date) }))
    },
    async updateEvent(id, patch) {
      const body = {
        ...patch,
        date: patch.date ? toISODate(patch.date) : undefined,
        occurrence: patch.occurrence ? toISODate(patch.occurrence) : undefined,
        skip: patch.skip ? toISODate(patch.skip) : undefined,
      }
      return toEvent(await request<EventDTO>(`/api/events/${id}`, { method: 'PATCH', body: JSON.stringify(body) }))
    },
    deleteEvent: (id) => request<void>(`/api/events/${id}`, { method: 'DELETE' }),
    rsvpEvent: (id, status) => post<Invite>(`/api/events/${id}/rsvp`, { status }),
    async search(query) {
      const res = await request<{ events: EventDTO[]; tasks: Task[] }>(`/api/search?q=${encodeURIComponent(query)}`)
      return { events: res.events.map(toEvent), tasks: res.tasks }
    },
    async getMonthDots(year, month) {
      const raw = await request<Record<string, Badge[]>>(`/api/month?year=${year}&month=${month + 1}`)
      return Object.fromEntries(Object.entries(raw).map(([day, badges]) => [Number(day), badges]))
    },
    getTasks: () => request<Task[]>('/api/tasks'),
    createTask: (input) => post<Task>('/api/tasks', input),
    updateTask: (id, patch) => request<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    deleteTask: (id) => request<void>(`/api/tasks/${id}`, { method: 'DELETE' }),
    getMessages: () => request<ChatMessage[]>('/api/messages'),
    async sendChat(text, onEvent, signal, image) {
      let res: Response
      try {
        res = await send('/api/chat', {
          method: 'POST',
          body: JSON.stringify(image ? { text, image } : { text }),
          signal,
        })
      } catch (e) {
        if (signal?.aborted) return
        throw e
      }
      if (!res.body) throw new ApiError(0, 'Сервер не прислал ответ')
      // Сервер уже сохранил реплику: дальше любая ошибка — обрыв ответа, а не «не отправлено».
      onEvent({ type: 'open' })
      // SSE: фреймы вида «data: {json}» разделены пустой строкой.
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let cut = buf.indexOf('\n\n')
          while (cut >= 0) {
            for (const line of buf.slice(0, cut).split('\n')) {
              if (!line.startsWith('data:')) continue
              try {
                onEvent(JSON.parse(line.slice(5)) as ChatEvent)
              } catch {
                /* битый фрейм пропускаем */
              }
            }
            buf = buf.slice(cut + 2)
            cut = buf.indexOf('\n\n')
          }
        }
      } catch {
        if (signal?.aborted) return
        throw new ApiError(0, 'Связь оборвалась во время ответа')
      } finally {
        reader.releaseLock()
      }
    },

    me: () => request<User>('/api/me'),
    async updateMe(name) {
      const user = await request<User>('/api/me', { method: 'PATCH', body: JSON.stringify({ name }) })
      const s = getSession()
      if (s) setSession({ ...s, user })
      return user
    },
    async login(input) {
      const s = await post<Session>('/api/auth/login', input)
      setSession(s)
      return s
    },
    async register(input) {
      const s = await post<Session>('/api/auth/register', input)
      setSession(s)
      return s
    },
    async logout() {
      try {
        await post<void>('/api/auth/logout', {})
      } finally {
        setSession(null)
      }
    },
    searchUsers: (query) => request<User[]>(`/api/users?q=${encodeURIComponent(query)}`),
    getNotifications: () => request<AppNotification[]>('/api/notifications'),
    markNotificationsRead: () => post<void>('/api/notifications/read', {}),
    addTaskMember: (taskId, username) => post<Task>(`/api/tasks/${taskId}/members`, { username }),
    removeTaskMember: (taskId, username) =>
      request<Task>(`/api/tasks/${taskId}/members/${encodeURIComponent(username)}`, { method: 'DELETE' }),
    async setTimeZone(timeZone) {
      const user = await request<User>('/api/me', { method: 'PATCH', body: JSON.stringify({ timeZone }) })
      const s = getSession()
      if (s) setSession({ ...s, user })
      return user
    },

    getIntegrations: () => request<IntegrationsInfo>('/api/integrations'),
    async discoverCalDav(input) {
      const res = await post<{ calendars: CalDavCalendar[] }>('/api/integrations/caldav/discover', input)
      return res.calendars
    },
    createIntegration: (input) => post<Integration>('/api/integrations', input),
    updateIntegration: (id, patch) =>
      request<Integration>(`/api/integrations/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    deleteIntegration: (id) => request<void>(`/api/integrations/${id}`, { method: 'DELETE' }),
    syncIntegration: (id) => post<Integration>(`/api/integrations/${id}/sync`, {}),
    async startOAuth(provider) {
      return (await post<{ url: string }>(`/api/integrations/oauth/${provider}/start`, {})).url
    },
    async getFeed() {
      const { path } = await request<{ path: string }>('/api/feed')
      return path ? absolute(baseUrl, path) : null
    },
    async resetFeed() {
      return absolute(baseUrl, (await post<{ path: string }>('/api/feed', {})).path)
    },
    disableFeed: () => request<void>('/api/feed', { method: 'DELETE' }),

    getPush: () => request<PushInfo>('/api/push'),
    updateNotifySettings: (patch) =>
      request<NotifySettings>('/api/push/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
    subscribePush: (sub) => post<void>('/api/push/subscriptions', sub),
    unsubscribePush: (endpoint) =>
      request<void>('/api/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
    async testPush() {
      return (await post<{ sent: number }>('/api/push/test', {})).sent
    },
    getDevices: () => request<PushDevice[]>('/api/push/devices'),
    deleteDevice: (id) => request<void>(`/api/push/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    getAlarms: () => request<Alarm[]>('/api/reminders'),
    createAlarm: ({ text, at }) => post<Alarm>('/api/reminders', { text, at: at.toISOString() }),
    deleteAlarm: (id) => request<void>(`/api/reminders/${id}`, { method: 'DELETE' }),

    getProfile: () => request<Profile>('/api/profile'),
    updateProfile: (patch) => request<Profile>('/api/profile', { method: 'PATCH', body: JSON.stringify(patch) }),
    getMemories: () => request<Memory[]>('/api/memories'),
    createMemory: (input) => post<Memory>('/api/memories', input),
    updateMemory: (id, patch) =>
      request<Memory>(`/api/memories/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    deleteMemory: (id) => request<void>(`/api/memories/${id}`, { method: 'DELETE' }),
    deleteAllMemories: () => request<void>('/api/memories', { method: 'DELETE' }),
    getPeople: () => request<Person[]>('/api/people'),
    createPerson: (input) => post<Person>('/api/people', input),
    updatePerson: (id, input) => request<Person>(`/api/people/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    deletePerson: (id) => request<void>(`/api/people/${id}`, { method: 'DELETE' }),
    getSessions: () => request<AuthSession[]>('/api/auth/sessions'),
    deleteSession: (id) => request<void>(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    logoutOthers: () => post<void>('/api/auth/logout-others', {}),
    changePassword: (current, next) => post<void>('/api/auth/password', { current, next }),
    exportData: async () => JSON.stringify(await request<unknown>('/api/export'), null, 2),
    async deleteAccount(password) {
      await request<void>('/api/me', { method: 'DELETE', body: JSON.stringify({ password }) })
      setSession(null)
    },
    getSuggestions: () => request<Suggestion[]>('/api/suggestions'),
    acceptSuggestion: async (id) =>
      (await post<{ suggestion: Suggestion }>(`/api/suggestions/${id}/accept`, {})).suggestion,
    dismissSuggestion: async (id, mute) => {
      await post<unknown>(`/api/suggestions/${id}/dismiss`, mute ? { mute: true } : {})
    },
  }
}

function errorMessage(body: unknown, status: number): string {
  return body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
    ? body.error
    : `Ошибка сервера (${status})`
}

/** Сервер доступен, если /api/health отвечает быстро и правильно. */
export async function probeServer(baseUrl = '', timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return false
    const body: unknown = await res.json()
    return !!body && typeof body === 'object' && 'status' in body && body.status === 'ok'
  } catch {
    return false
  }
}
