import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import type {
  AppNotification,
  CalendarEvent,
  ChatMessage,
  DatedEvent,
  EventPatch,
  NewEvent,
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
}

const NO_EVENTS: CalendarEvent[] = []

/** События дня. Пока грузятся — предыдущий день (без мигания при листании) или пустой список. */
export function useDayEvents(date: Date) {
  const api = useApi()
  const query = useQuery({
    queryKey: keys.events(date),
    queryFn: () => api.getEvents(date),
    placeholderData: keepPreviousData,
  })
  return { ...query, events: query.data ?? NO_EVENTS }
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

/** Уведомления с периодической проверкой: бейдж непрочитанных на аватаре. */
export function useNotifications() {
  const api = useApi()
  const query = useQuery({
    queryKey: keys.notifications,
    queryFn: () => api.getNotifications(),
    refetchInterval: 60_000,
  })
  const notifications = query.data ?? NO_NOTIFICATIONS
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

/** Сообщение сразу появляется в чате (оптимистично), затем заменяется ответом сервера. */
export function useAddMessage() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ role, text }: Pick<ChatMessage, 'role' | 'text'>) => api.addMessage(role, text),
    onMutate: async ({ role, text }) => {
      await qc.cancelQueries({ queryKey: keys.messages })
      const previous = qc.getQueryData<ChatMessage[]>(keys.messages)
      qc.setQueryData<ChatMessage[]>(keys.messages, (list = []) => [
        ...list,
        { id: (list.at(-1)?.id ?? 0) + 1, role, text },
      ])
      return { previous }
    },
    onError: (_err, _vars, ctx) => qc.setQueryData(keys.messages, ctx?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.messages }),
  })
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

/** Сообщение, которое не ушло до сервера: живёт локально, пока его не повторят или не сотрут. */
export type FailedMessage = { id: number; text: string; error: string }

/**
 * Отправка сообщения ассистенту. Пузырь пользователя добавляем оптимистично —
 * сервер сохранит его сам; ответ собирается из SSE-стрима в `stream`,
 * по завершении история и календарь обновляются с сервера.
 * При ошибке пузырь не пропадает молча: он переезжает в `failed` —
 * заметный, с текстом ошибки и возможностью отправить заново.
 */
export function useSendChat() {
  const api = useApi()
  const qc = useQueryClient()
  const [stream, setStream] = useState<ChatStream | null>(null)
  const [failed, setFailed] = useState<FailedMessage[]>([])

  const send = useCallback(
    async (text: string) => {
      const value = text.trim()
      if (!value) return
      setFailed((list) => list.filter((m) => m.text !== value))
      qc.setQueryData<ChatMessage[]>(keys.messages, (list = []) => [
        ...list,
        { id: (list.at(-1)?.id ?? 0) + 1, role: 'user', text: value },
      ])
      setStream({ text: '', tools: [], done: false, error: null })
      let error: string | null = null
      try {
        await api.sendChat(value, (e) => {
          if (e.type === 'delta') {
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
        })
      } catch (err) {
        error = apiErrorText(err)
      }
      // На сервере уже лежат сохранённые реплики и изменения инструментов.
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.messages }),
        qc.invalidateQueries({ queryKey: keys.allEvents }),
        qc.invalidateQueries({ queryKey: keys.allMonths }),
        qc.invalidateQueries({ queryKey: keys.tasks }),
      ])
      setStream(null)
      if (error) {
        const message = error
        setFailed((list) => [...list, { id: Date.now(), text: value, error: message }])
      }
    },
    [api, qc],
  )

  const dismissFailed = useCallback((id: number) => {
    setFailed((list) => list.filter((m) => m.id !== id))
  }, [])

  return { stream, send, failed, dismissFailed }
}
