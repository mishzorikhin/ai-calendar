import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppNotification,
  CalDavCredentials,
  CalendarEvent,
  ChatMessage,
  DatedEvent,
  EventPatch,
  IntegrationPatch,
  IntegrationsInfo,
  NewEvent,
  NewIntegration,
  NewTask,
  Task,
  TaskPatch,
} from '../domain/types'
import { isSameDay, toISODate } from '../lib/dates'
import { apiErrorText } from './api'
import { useApi } from './provider'
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
      void qc.invalidateQueries({ queryKey: keys.events(event.date) })
      void qc.invalidateQueries({ queryKey: keys.allMonths })
    },
  })
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
      const merged: DatedEvent = { ...event, ...patch }
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
    mutationFn: () => api.logout(),
    // Чистим кэш всегда: даже если запрос выхода не дошёл, данные показывать нельзя.
    onSettled: () => qc.clear(),
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
 * Новое уведомление значит, что с вами поделились задачей, — тогда перечитываем
 * и задачи: общая задача появляется без перезагрузки и без отдельного опроса.
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
    if (seen.current !== undefined && newest > seen.current) void qc.invalidateQueries({ queryKey: keys.tasks })
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
export type FailedMessage = { id: number; text: string; error: string; delivered: boolean }

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
    async (text: string) => {
      const value = text.trim()
      if (!value || active.current) return
      const ctl = new AbortController()
      active.current = ctl
      setFailed((list) => list.filter((m) => m.text !== value))
      qc.setQueryData<ChatMessage[]>(keys.messages, (list = []) => [
        ...list,
        { id: (list.at(-1)?.id ?? 0) + 1, role: 'user', text: value },
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
        ])
      } finally {
        active.current = null
      }
      if (ctl.signal.aborted) return
      setStream(null)
      if (error) {
        const message = error
        setFailed((list) => [...list, { id: Date.now(), text: value, error: message, delivered }])
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
