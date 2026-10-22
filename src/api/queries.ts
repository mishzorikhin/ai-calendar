import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Alarm,
  AppNotification,
  CalDavCredentials,
  CalendarEvent,
  ChatMessage,
  DatedEvent,
  EventPatch,
  IntegrationPatch,
  IntegrationsInfo,
  Memory,
  MemoryKind,
  MemoryPatch,
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
  PushInfo,
  Rsvp,
  SearchResult,
  Task,
  TaskPatch,
} from '../domain/types'
import { withCheck } from '../domain/habit'
import { isSameDay, toISODate } from '../lib/dates'
import { apiErrorText } from './api'
import { useApi } from './provider'
import { disablePush } from './push'
import { useSession } from './session'

/** Ключи кэша — в одном месте, чтобы инвалидация не расходилась с запросами. */
export const keys = {
  events: (date: Date) => ['events', toISODate(date)] as const,
  allEvents: ['events'] as const,
  month: (year: number, month: number) => ['month', year, month] as const,
  allMonths: ['month'] as const,
  messages: ['messages'] as const,
  tasks: ['tasks'] as const,
  me: ['me'] as const,
  users: (q: string) => ['users', q] as const,
  notifications: ['notifications'] as const,
  integrations: ['integrations'] as const,
  feed: ['feed'] as const,
  push: ['push'] as const,
  /** Подписка этого браузера (зависит от того, кто вошёл). */
  pushDevice: (userId: number | undefined) => ['push-device', userId] as const,
  devices: ['push-devices'] as const,
  /** id подписки этого браузера — чтобы отметить его в списке устройств. */
  pushDeviceId: ['push-device-id'] as const,
  alarms: ['alarms'] as const,
  profile: ['profile'] as const,
  search: (q: string) => ['search', q] as const,
  memories: ['memories'] as const,
  people: ['people'] as const,
  suggestions: ['suggestions'] as const,
  sessions: ['auth-sessions'] as const,
  week: (start: string) => ['week', start] as const,
}

const NO_EVENTS: CalendarEvent[] = []

/** Делит события дня на события со временем и события на весь день. */
function splitAllDay(list: CalendarEvent[]): { timed: CalendarEvent[]; allDay: CalendarEvent[] } {
  if (!list.some((e) => e.allDay)) return { timed: list, allDay: NO_EVENTS }
  return { timed: list.filter((e) => !e.allDay), allDay: list.filter((e) => e.allDay) }
}

/**
 * События дня. Пока грузятся — предыдущий день (без мигания при листании) или пустой список.
 * Там, где по событиям считаются свободные окна и конфликты, передавайте `keepPrevious: false`:
 * иначе время будет посчитано по чужому дню.
 *
 * `events` — только события со временем (шкала, окна, «Далее»); события на весь день
 * (праздники и дни рождения из подключённых календарей) — отдельно в `allDay`.
 */
export function useDayEvents(date: Date, { keepPrevious = true }: { keepPrevious?: boolean } = {}) {
  const api = useApi()
  const query = useQuery({
    queryKey: keys.events(date),
    queryFn: () => api.getEvents(date),
    placeholderData: keepPrevious ? keepPreviousData : undefined,
    select: splitAllDay,
  })
  return { ...query, events: query.data?.timed ?? NO_EVENTS, allDay: query.data?.allDay ?? NO_EVENTS }
}

export function useMonthDots(year: number, month: number) {
  const api = useApi()
  return useQuery({ queryKey: keys.month(year, month), queryFn: () => api.getMonthDots(year, month) })
}

export function useCreateEvent() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: NewEvent) => api.createEvent(input),
    onSuccess: (event) => {
      // У серии вхождения во многих днях — перечитываем все.
      void qc.invalidateQueries({ queryKey: event.repeat ? keys.allEvents : keys.events(event.date) })
      void qc.invalidateQueries({ queryKey: keys.allMonths })
    },
  })
}

/** Поля события из патча: occurrence/skip/attendees — указания серверу, а '' у повтора — «без повтора». */
function eventFields({ occurrence: _o, skip: _s, attendees: _a, repeat, ...fields }: EventPatch): Partial<DatedEvent> {
  return repeat === undefined ? fields : { ...fields, repeat: repeat || undefined }
}

/** Оптимистичное изменение события; при смене дня переносим между кэшами дней. */
export function useUpdateEvent() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ event, patch }: { event: DatedEvent; patch: EventPatch }) => api.updateEvent(event.id, patch),
    onMutate: async ({ event, patch }) => {
      await qc.cancelQueries({ queryKey: keys.allEvents })
      const previous = qc.getQueriesData<CalendarEvent[]>({ queryKey: keys.allEvents })
      const merged: DatedEvent = { ...event, ...eventFields(patch) }
      if (patch.skip) {
        qc.setQueryData<CalendarEvent[]>(keys.events(patch.skip), (list = []) => list.filter((e) => e.id !== event.id))
        return { previous }
      }
      // Остальные дни серии обновит перечитывание после ответа (onSettled).
      const moved = patch.date && !isSameDay(patch.date, event.date)
      const byStart = (a: CalendarEvent, b: CalendarEvent) => a.start - b.start
      qc.setQueryData<CalendarEvent[]>(keys.events(event.date), (list = []) =>
        moved ? list.filter((e) => e.id !== event.id) : list.map((e) => (e.id === event.id ? merged : e)).sort(byStart),
      )
      if (moved) {
        qc.setQueryData<CalendarEvent[]>(keys.events(merged.date), (list = []) => [...list, merged].sort(byStart))
      }
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.previous ?? []) qc.setQueryData(key, data)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.allEvents })
      void qc.invalidateQueries({ queryKey: keys.allMonths })
    },
  })
}

/** Ответ на приглашение: отказ убирает встречу из дня сразу. */
export function useRsvp() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ event, status }: { event: DatedEvent; status: Rsvp }) => api.rsvpEvent(event.id, status),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.allEvents })
      void qc.invalidateQueries({ queryKey: keys.allMonths })
    },
  })
}

export function useDeleteEvent() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (event: DatedEvent) => api.deleteEvent(event.id),
    onMutate: async (event) => {
      await qc.cancelQueries({ queryKey: keys.allEvents })
      const previous = qc.getQueriesData<CalendarEvent[]>({ queryKey: keys.allEvents })
      qc.setQueryData<CalendarEvent[]>(keys.events(event.date), (list = []) => list.filter((e) => e.id !== event.id))
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.previous ?? []) qc.setQueryData(key, data)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.allEvents })
      void qc.invalidateQueries({ queryKey: keys.allMonths })
    },
  })
}

// --- Аккаунт, люди, уведомления ---------------------------------------------

/** Текущий пользователь: сессия уже в localStorage, me лишь освежает профиль. */
export function useMe() {
  const api = useApi()
  const session = useSession()
  return useQuery({
    queryKey: keys.me,
    queryFn: () => api.me(),
    enabled: api.mode === 'local' || !!session,
    initialData: session?.user,
    staleTime: 5 * 60_000,
  })
}

/** Вход/регистрация: сессию сохраняет сам http-клиент, здесь чистим кэш от прошлого аккаунта. */
export function useLogin() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { username: string; password: string }) => api.login(input),
    onSuccess: () => qc.clear(),
  })
}

export function useRegister() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { username: string; name?: string; password: string }) => api.register(input),
    onSuccess: () => qc.clear(),
  })
}

export function useLogout() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      // Уведомления этого аккаунта на устройстве больше не нужны. Без сети не ждём дольше пары секунд:
      // подписка браузера снимется всё равно, а сервер забудет её по ответу 410.
      if (api.mode === 'server') {
        await Promise.race([disablePush(api).catch(() => {}), new Promise((r) => setTimeout(r, 2500))])
      }
      await api.logout()
    },
    // Чистим кэш всегда: даже если запрос выхода не дошёл, данные показывать нельзя.
    onSettled: () => qc.clear(),
  })
}

/** Обзор недели, в которую входит start. */
export function useWeekInsights(start: Date) {
  const api = useApi()
  return useQuery<WeekInsights>({ queryKey: keys.week(toISODate(start)), queryFn: () => api.getWeekInsights(start) })
}

/** Устройства, где выполнен вход. */
export function useSessions() {
  const api = useApi()
  const query = useQuery({ queryKey: keys.sessions, queryFn: () => api.getSessions() })
  return { ...query, sessions: query.data ?? NO_SESSIONS }
}
const NO_SESSIONS: AuthSession[] = []

/** Завершить сеанс одного устройства (id) или всех остальных (null). */
export function useEndSessions() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string | null) => (id === null ? api.logoutOthers() : api.deleteSession(id)),
    // Сервер снял push-подписки всех устройств — это устройство подписывается заново при сверке.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['push-device'] }),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.sessions }),
  })
}

export function useChangePassword() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) => api.changePassword(current, next),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.sessions })
      void qc.invalidateQueries({ queryKey: ['push-device'] })
    },
  })
}

/** Выгрузка всех своих данных (текст JSON-файла). */
export function useExportData() {
  const api = useApi()
  return useMutation({ mutationFn: () => api.exportData() })
}

/** Удалить аккаунт: подписка устройства снимается, кэш стирается — как при выходе. */
export function useDeleteAccount() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (password: string) => {
      await api.deleteAccount(password)
      await Promise.race([disablePush(api).catch(() => {}), new Promise((r) => setTimeout(r, 2500))])
    },
    onSuccess: () => qc.clear(),
  })
}

export function useUpdateMe() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.updateMe(name),
    onSuccess: (user) => qc.setQueryData(keys.me, user),
  })
}

/**
 * Сообщает серверу пояс браузера, если он другой: в нём сервер раскладывает
 * внешние календари по дням. Вызывается один раз в корне приложения.
 */
export function useSyncTimeZone() {
  const api = useApi()
  const qc = useQueryClient()
  const { data: me } = useMe()
  const known = me?.timeZone
  const userId = me?.id
  useEffect(() => {
    if (api.mode !== 'server' || userId === undefined) return
    let zone: string
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return
    }
    if (!zone || zone === known) return
    api
      .setTimeZone(zone)
      .then((user) => {
        qc.setQueryData(keys.me, user)
        // Внешние события могли лечь в другие дни — перечитываем.
        void qc.invalidateQueries({ queryKey: keys.allEvents })
        void qc.invalidateQueries({ queryKey: keys.allMonths })
      })
      .catch(() => {
        /* без сети попробуем при следующем запуске */
      })
  }, [api, qc, known, userId])
}

/** Люди для @упоминаний и шаринга: пустой запрос — все пользователи кроме себя. */
export function useUserSearch(query: string) {
  const api = useApi()
  return useQuery({
    queryKey: keys.users(query),
    queryFn: () => api.searchUsers(query),
    staleTime: 30_000,
  })
}

const NO_NOTIFICATIONS: AppNotification[] = []

/**
 * Уведомления с периодической проверкой: бейдж непрочитанных на аватаре.
 * Новое уведомление значит, что с вами поделились задачей или позвали на встречу, — тогда
 * перечитываем задачи и дни: они появляются без перезагрузки и без отдельного опроса.
 */
export function useNotifications() {
  const api = useApi()
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: keys.notifications,
    queryFn: () => api.getNotifications(),
    refetchInterval: 60_000,
  })
  const notifications = query.data ?? NO_NOTIFICATIONS
  // -1 — список загружен и пуст: первое же уведомление тоже новое. undefined — ещё не загружен.
  const newest = query.data ? (notifications[0]?.id ?? -1) : undefined
  const seen = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (newest === undefined) return
    if (seen.current !== undefined && newest > seen.current) {
      // Новое уведомление — общая задача, приглашение, перенос или отмена встречи: перечитываем их.
      void qc.invalidateQueries({ queryKey: keys.tasks })
      void qc.invalidateQueries({ queryKey: keys.allEvents })
      void qc.invalidateQueries({ queryKey: keys.allMonths })
    }
    seen.current = newest
  }, [newest, qc])
  return { ...query, notifications, unread: notifications.filter((n) => !n.read).length }
}

export function useMarkNotificationsRead() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.markNotificationsRead(),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: keys.notifications })
      const previous = qc.getQueryData<AppNotification[]>(keys.notifications)
      qc.setQueryData<AppNotification[]>(keys.notifications, (list = []) => list.map((n) => ({ ...n, read: true })))
      return { previous }
    },
    onError: (_err, _vars, ctx) => qc.setQueryData(keys.notifications, ctx?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  })
}

/** Добавить/убрать участника общей задачи по логину. */
export function useTaskMembers() {
  const api = useApi()
  const qc = useQueryClient()
  const done = () => void qc.invalidateQueries({ queryKey: keys.tasks })
  const add = useMutation({
    mutationFn: ({ taskId, username }: { taskId: string; username: string }) => api.addTaskMember(taskId, username),
    onSettled: done,
  })
  const remove = useMutation({
    mutationFn: ({ taskId, username }: { taskId: string; username: string }) => api.removeTaskMember(taskId, username),
    onSettled: done,
  })
  return { add, remove }
}

const NO_TASKS: Task[] = []

export function useTasks() {
  const api = useApi()
  const query = useQuery({ queryKey: keys.tasks, queryFn: () => api.getTasks() })
  return { ...query, tasks: query.data ?? NO_TASKS }
}

export function useCreateTask() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: NewTask) => api.createTask(input),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.tasks }),
  })
}

/** Патч задачи (галочка, категория): меняем кэш сразу, откат при ошибке. */
export function useUpdateTask() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) => api.updateTask(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: keys.tasks })
      const previous = qc.getQueryData<Task[]>(keys.tasks)
      qc.setQueryData<Task[]>(keys.tasks, (list = []) =>
        list.map((t) =>
          t.id === id
            ? {
                ...t,
                title: patch.title ?? t.title,
                subtitle: patch.subtitle ?? t.subtitle,
                kind: patch.kind ?? t.kind,
                done: patch.done ?? t.done,
                due: patch.due ?? t.due,
                category: patch.category === undefined ? t.category : patch.category || undefined,
                estimate: patch.estimate === undefined ? t.estimate : patch.estimate || undefined,
                cadence: patch.cadence ?? t.cadence,
                checks: patch.check
                  ? withCheck(t.checks ?? [], patch.check, true)
                  : patch.uncheck
                    ? withCheck(t.checks ?? [], patch.uncheck, false)
                    : t.checks,
              }
            : t,
        ),
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => qc.setQueryData(keys.tasks, ctx?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.tasks }),
  })
}

export function useDeleteTask() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteTask(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: keys.tasks })
      const previous = qc.getQueryData<Task[]>(keys.tasks)
      qc.setQueryData<Task[]>(keys.tasks, (list = []) => list.filter((t) => t.id !== id))
      return { previous }
    },
    onError: (_err, _vars, ctx) => qc.setQueryData(keys.tasks, ctx?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.tasks }),
  })
}

const NO_MESSAGES: ChatMessage[] = []

export function useMessages() {
  const api = useApi()
  const query = useQuery({ queryKey: keys.messages, queryFn: () => api.getMessages() })
  return query.data ?? NO_MESSAGES
}

/** Вызов инструмента в ходе ответа ассистента. date — день, к которому он относится. */
export type ChatToolRun = { name: string; done: boolean; detail?: string; date?: string }

/** Текущий ответ ассистента: стриминг текста и статусы инструментов. */
export type ChatStream = {
  text: string
  tools: ChatToolRun[]
  /** Стрим завершён (done или ошибка). */
  done: boolean
  error: string | null
}

/**
 * Сообщение, на которое не пришёл ответ: живёт локально, пока его не повторят или не сотрут.
 * delivered — сервер реплику получил (она уже в истории), оборвался только ответ.
 */
export type FailedMessage = { id: number; text: string; image?: string; error: string; delivered: boolean }

/** Пометка картинки в истории — та же, что пишет сервер. */
export const IMAGE_MARK = '📎 фото'

/**
 * Отправка сообщения ассистенту. Пузырь пользователя добавляем оптимистично —
 * сервер сохранит его сам; ответ собирается из SSE-стрима в `stream`,
 * по завершении история и календарь обновляются с сервера.
 * При ошибке пузырь не пропадает молча: он переезжает в `failed` —
 * заметный, с текстом ошибки и возможностью отправить заново.
 * Пока ответ идёт, новая отправка игнорируется; уход из чата прерывает чтение ответа
 * (сервер всё равно доведёт и сохранит его).
 */
export function useSendChat() {
  const api = useApi()
  const qc = useQueryClient()
  const [stream, setStream] = useState<ChatStream | null>(null)
  const [failed, setFailed] = useState<FailedMessage[]>([])
  const active = useRef<AbortController | null>(null)

  useEffect(() => () => active.current?.abort(), [])

  const send = useCallback(
    async (text: string, image?: string) => {
      const value = text.trim()
      if ((!value && !image) || active.current) return
      const shown = image ? `${value}\n${IMAGE_MARK}`.trim() : value
      const ctl = new AbortController()
      active.current = ctl
      setFailed((list) => list.filter((m) => m.text !== value))
      qc.setQueryData<ChatMessage[]>(keys.messages, (list = []) => [
        ...list,
        { id: (list.at(-1)?.id ?? 0) + 1, role: 'user', text: shown },
      ])
      setStream({ text: '', tools: [], done: false, error: null })
      let error: string | null = null
      let delivered = false
      try {
        await api.sendChat(
          value,
          (e) => {
            if (e.type === 'open') {
              delivered = true
            } else if (e.type === 'delta') {
              setStream((s) => s && { ...s, text: s.text + e.text })
            } else if (e.type === 'tool') {
              setStream((s) => {
                if (!s) return s
                if (e.status === 'run') return { ...s, tools: [...s.tools, { name: e.name, done: false }] }
                // done закрывает последний ещё идущий вызов с этим именем.
                const tools = [...s.tools]
                for (let i = tools.length - 1; i >= 0; i--) {
                  const t = tools[i]
                  if (t && !t.done && t.name === e.name) {
                    tools[i] = { ...t, done: true, detail: e.detail, date: e.date }
                    break
                  }
                }
                return { ...s, tools }
              })
            } else if (e.type === 'error') {
              error = e.message
              setStream((s) => s && { ...s, done: true, error: e.message })
            }
          },
          ctl.signal,
          image,
        )
      } catch (err) {
        error = apiErrorText(err)
      }
      // На сервере уже лежат сохранённые реплики и изменения инструментов.
      // Отправка занята до конца: пока история не перечитана, новый поток стёр бы этот.
      try {
        await Promise.all([
          qc.invalidateQueries({ queryKey: keys.messages }),
          qc.invalidateQueries({ queryKey: keys.allEvents }),
          qc.invalidateQueries({ queryKey: keys.allMonths }),
          qc.invalidateQueries({ queryKey: keys.tasks }),
          // Ассистент мог запомнить факт, добавить человека или поменять профиль.
          qc.invalidateQueries({ queryKey: keys.memories }),
          qc.invalidateQueries({ queryKey: keys.people }),
          qc.invalidateQueries({ queryKey: keys.profile }),
        ])
      } finally {
        active.current = null
      }
      if (ctl.signal.aborted) return
      setStream(null)
      if (error) {
        const message = error
        setFailed((list) => [...list, { id: Date.now(), text: value, image, error: message, delivered }])
      }
    },
    [api, qc],
  )

  const dismissFailed = useCallback((id: number) => {
    setFailed((list) => list.filter((m) => m.id !== id))
  }, [])

  /** Ответ ещё идёт или история перечитывается — отправлять новое нельзя. */
  const busy = stream !== null
  return { stream, busy, send, failed, dismissFailed }
}

// --- Внешние календари ------------------------------------------------------

const NO_INTEGRATIONS: IntegrationsInfo = { items: [], providers: { google: false, outlook: false } }

/** Подключённые календари; пока идёт синхронизация на сервере, статус обновляется сам. */
export function useIntegrations() {
  const api = useApi()
  const query = useQuery({ queryKey: keys.integrations, queryFn: () => api.getIntegrations() })
  return { ...query, info: query.data ?? NO_INTEGRATIONS }
}

/** После изменений календарей перечитываем список и все дни: события могли появиться или пропасть. */
function useCalendarsChanged() {
  const qc = useQueryClient()
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: keys.integrations })
    void qc.invalidateQueries({ queryKey: keys.allEvents })
    void qc.invalidateQueries({ queryKey: keys.allMonths })
  }, [qc])
}

/** Название календаря, откуда пришло событие (для подписи в карточке и шторке). */
export function useCalendarName(source: string | undefined): string | undefined {
  const api = useApi()
  const { data } = useQuery({
    queryKey: keys.integrations,
    queryFn: () => api.getIntegrations(),
    enabled: !!source && api.mode === 'server',
    staleTime: 60_000,
    select: (info: IntegrationsInfo) => info.items.find((i) => i.id === source)?.name,
  })
  return source ? (data ?? 'Подключённый календарь') : undefined
}

/** Календарь, куда уходят новые события, если он назначен. */
export function usePrimaryCalendar(): string | undefined {
  const api = useApi()
  const { data } = useQuery({
    queryKey: keys.integrations,
    queryFn: () => api.getIntegrations(),
    enabled: api.mode === 'server',
    staleTime: 60_000,
    select: (info: IntegrationsInfo) => info.items.find((i) => i.primary && i.writable)?.name,
  })
  return data
}

export function useDiscoverCalDav() {
  const api = useApi()
  return useMutation({ mutationFn: (input: CalDavCredentials) => api.discoverCalDav(input) })
}

export function useCreateIntegration() {
  const api = useApi()
  const changed = useCalendarsChanged()
  return useMutation({ mutationFn: (input: NewIntegration) => api.createIntegration(input), onSuccess: changed })
}

export function useUpdateIntegration() {
  const api = useApi()
  const changed = useCalendarsChanged()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: IntegrationPatch }) => api.updateIntegration(id, patch),
    onSettled: changed,
  })
}

export function useDeleteIntegration() {
  const api = useApi()
  const changed = useCalendarsChanged()
  return useMutation({ mutationFn: (id: string) => api.deleteIntegration(id), onSettled: changed })
}

export function useSyncIntegration() {
  const api = useApi()
  const changed = useCalendarsChanged()
  return useMutation({ mutationFn: (id: string) => api.syncIntegration(id), onSettled: changed })
}

/** Вход в Google/Microsoft: получаем ссылку и уходим на страницу согласия. */
export function useStartOAuth() {
  const api = useApi()
  return useMutation({
    mutationFn: (provider: 'google' | 'outlook') => api.startOAuth(provider),
    onSuccess: (url) => window.location.assign(url),
  })
}

/** Ссылка на ленту .ics пользователя. */
export function useFeed() {
  const api = useApi()
  const qc = useQueryClient()
  const query = useQuery({ queryKey: keys.feed, queryFn: () => api.getFeed(), enabled: api.mode === 'server' })
  const reset = useMutation({ mutationFn: () => api.resetFeed(), onSuccess: (url) => qc.setQueryData(keys.feed, url) })
  const disable = useMutation({
    mutationFn: () => api.disableFeed(),
    onSuccess: () => qc.setQueryData(keys.feed, null),
  })
  return { url: query.data ?? null, isLoading: query.isLoading, reset, disable }
}

/** Уведомления аккаунта: ключ сервера, настройки напоминаний, сколько устройств подписано. */
export function usePush() {
  const api = useApi()
  const session = useSession()
  return useQuery({
    queryKey: keys.push,
    queryFn: () => api.getPush(),
    enabled: api.mode === 'local' || !!session,
    staleTime: 5 * 60_000,
  })
}

/** Настройки напоминаний — сразу в кэше, откат при ошибке. */
export function useUpdateNotifySettings() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<NotifySettings>) => api.updateNotifySettings(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: keys.push })
      const previous = qc.getQueryData<PushInfo>(keys.push)
      if (previous) qc.setQueryData<PushInfo>(keys.push, { ...previous, settings: { ...previous.settings, ...patch } })
      return { previous }
    },
    onError: (_err, _vars, ctx) => qc.setQueryData(keys.push, ctx?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.push }),
  })
}

export function useTestPush() {
  const api = useApi()
  return useMutation({ mutationFn: () => api.testPush() })
}

/** Свои напоминания без события и отложенные из уведомлений. */
export function useAlarms() {
  const api = useApi()
  const query = useQuery({ queryKey: keys.alarms, queryFn: () => api.getAlarms(), enabled: api.mode === 'server' })
  return { ...query, alarms: query.data ?? NO_ALARMS }
}

const NO_ALARMS: Alarm[] = []

export function useCreateAlarm() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { text: string; at: Date }) => api.createAlarm(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.alarms }),
  })
}

export function useDeleteAlarm() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.deleteAlarm(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: keys.alarms })
      const previous = qc.getQueryData<Alarm[]>(keys.alarms)
      qc.setQueryData<Alarm[]>(keys.alarms, (list = []) => list.filter((a) => a.id !== id))
      return { previous }
    },
    onError: (_err, _id, ctx) => qc.setQueryData(keys.alarms, ctx?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.alarms }),
  })
}

/** Устройства с уведомлениями. */
export function useDevices() {
  const api = useApi()
  return useQuery({ queryKey: keys.devices, queryFn: () => api.getDevices(), enabled: api.mode === 'server' })
}

export function useDeleteDevice() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteDevice(id),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.devices })
      void qc.invalidateQueries({ queryKey: keys.push })
    },
  })
}

// --- Персонализация: профиль, память, люди ------------------------------------

/** Профиль пользователя: ритм дня, рабочее время, манера общения ассистента. */
export function useProfile() {
  const api = useApi()
  const session = useSession()
  return useQuery({
    queryKey: keys.profile,
    queryFn: () => api.getProfile(),
    enabled: api.mode === 'local' || !!session,
    staleTime: 5 * 60_000,
  })
}

/** Изменение профиля — сразу в кэше, откат при ошибке. */
export function useUpdateProfile() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: ProfilePatch) => api.updateProfile(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: keys.profile })
      const previous = qc.getQueryData<Profile>(keys.profile)
      if (previous) qc.setQueryData<Profile>(keys.profile, { ...previous, ...patch })
      return { previous }
    },
    onError: (_err, _vars, ctx) => qc.setQueryData(keys.profile, ctx?.previous),
    onSuccess: (profile) => qc.setQueryData(keys.profile, profile),
  })
}

const NO_MEMORIES: Memory[] = []

/** Факты в памяти ассистента, новые первыми. */
export function useMemories() {
  const api = useApi()
  const query = useQuery({ queryKey: keys.memories, queryFn: () => api.getMemories() })
  return { ...query, memories: query.data ?? NO_MEMORIES }
}

export function useCreateMemory() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { kind: MemoryKind; text: string; date?: string }) => api.createMemory(input),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.memories }),
  })
}

/** Правка факта; «Нет» у догадки (rejected) убирает её из списка сразу. */
export function useUpdateMemory() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: MemoryPatch }) => api.updateMemory(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: keys.memories })
      const previous = qc.getQueryData<Memory[]>(keys.memories)
      const { rejected, ...fields } = patch
      qc.setQueryData<Memory[]>(keys.memories, (list = []) =>
        rejected ? list.filter((m) => m.id !== id) : list.map((m) => (m.id === id ? { ...m, ...fields } : m)),
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => qc.setQueryData(keys.memories, ctx?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.memories }),
  })
}

export function useDeleteMemory() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.deleteMemory(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: keys.memories })
      const previous = qc.getQueryData<Memory[]>(keys.memories)
      qc.setQueryData<Memory[]>(keys.memories, (list = []) => list.filter((m) => m.id !== id))
      return { previous }
    },
    onError: (_err, _id, ctx) => qc.setQueryData(keys.memories, ctx?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.memories }),
  })
}

export function useDeleteAllMemories() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteAllMemories(),
    onSuccess: () => qc.setQueryData<Memory[]>(keys.memories, []),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.memories }),
  })
}

const NO_PEOPLE: Person[] = []

export function usePeople() {
  const api = useApi()
  const query = useQuery({ queryKey: keys.people, queryFn: () => api.getPeople() })
  return { ...query, people: query.data ?? NO_PEOPLE }
}

/** Создать (id нет) или заменить карточку человека. */
export function useSavePerson() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id?: number; input: PersonInput }) =>
      id === undefined ? api.createPerson(input) : api.updatePerson(id, input),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.people }),
  })
}

const NO_SUGGESTIONS: Suggestion[] = []

/** Предложения ассистента, ждущие ответа (карточки на главной). */
export function useSuggestions() {
  const api = useApi()
  const query = useQuery({ queryKey: keys.suggestions, queryFn: () => api.getSuggestions() })
  return { ...query, suggestions: query.data ?? NO_SUGGESTIONS }
}

/** Убрать карточку сразу, вернуть при ошибке. */
function useAnswerSuggestion<V extends { id: number }>(fn: (vars: V) => Promise<unknown>, after: (vars: V) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: keys.suggestions })
      const previous = qc.getQueryData<Suggestion[]>(keys.suggestions)
      qc.setQueryData<Suggestion[]>(keys.suggestions, (list = []) => list.filter((s) => s.id !== vars.id))
      return { previous }
    },
    onError: (_err, _vars, ctx) => qc.setQueryData(keys.suggestions, ctx?.previous),
    onSuccess: (_data, vars) => after(vars),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.suggestions }),
  })
}

/** «Да»: сервер создаёт событие или задачу — перечитываем их. */
export function useAcceptSuggestion() {
  const api = useApi()
  const qc = useQueryClient()
  return useAnswerSuggestion(
    ({ id }: { id: number }) => api.acceptSuggestion(id),
    () => {
      void qc.invalidateQueries({ queryKey: keys.allEvents })
      void qc.invalidateQueries({ queryKey: keys.allMonths })
      void qc.invalidateQueries({ queryKey: keys.tasks })
    },
  )
}

/** «Нет»; mute — «не предлагать такое» (меняет профиль). */
export function useDismissSuggestion() {
  const api = useApi()
  const qc = useQueryClient()
  return useAnswerSuggestion(
    ({ id, mute }: { id: number; mute?: boolean }) => api.dismissSuggestion(id, mute),
    ({ mute }) => {
      if (mute) void qc.invalidateQueries({ queryKey: keys.profile })
    },
  )
}

export function useDeletePerson() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.deletePerson(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: keys.people })
      const previous = qc.getQueryData<Person[]>(keys.people)
      qc.setQueryData<Person[]>(keys.people, (list = []) => list.filter((p) => p.id !== id))
      return { previous }
    },
    onError: (_err, _id, ctx) => qc.setQueryData(keys.people, ctx?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.people }),
  })
}

const NO_RESULT: SearchResult = { events: [], tasks: [] }

/** Поиск по событиям и задачам: от 2 символов, пока печатают — прошлый результат. */
export function useSearch(query: string) {
  const api = useApi()
  const q = query.trim()
  const query_ = useQuery({
    queryKey: keys.search(q),
    queryFn: () => api.search(q),
    enabled: [...q].length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })
  return { ...query_, result: [...q].length >= 2 ? (query_.data ?? NO_RESULT) : NO_RESULT }
}
