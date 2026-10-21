import type { CalendarEvent, DatedEvent, EventPatch, MonthDots, NewTask, Task, TaskPatch } from '../domain/types'
import { toISODate } from '../lib/dates'
import { ApiError, type CalendarApi } from './api'
import { getOutbox, newTempId, requestOutboxSync, type Outbox, type PendingOp } from './outbox'

/**
 * Обёртка серверного API, делающая его работоспособным без сети.
 *
 * - Мутации: при сетевой ошибке (ApiError со статусом 0) запрос складывается в очередь
 *   (outbox.ts), а вызывающему коду возвращается синтетический результат — UI видит
 *   изменение сразу и не показывает ошибку. Очередь повторяется при появлении сети.
 * - Чтения: поверх ответа (в т.ч. устаревшего из кэша service worker) применяются
 *   ещё не отправленные операции — созданные офлайн события видны, удалённые скрыты.
 */

type AnyOp = Omit<PendingOp, 'seq' | 'at'>

let outboxP: Promise<Outbox> | null = null
let flushBase = ''

const outbox = () => (outboxP ??= getOutbox())

/** Переопределить очередь — только в тестах (в node нет IndexedDB). */
export function setOutboxForTests(obx: Promise<Outbox>): void {
  outboxP = obx
}

const isNetError = (e: unknown) => e instanceof ApiError && e.status === 0

async function enqueue(op: AnyOp): Promise<void> {
  await (await outbox()).enqueue({ ...op, at: Date.now() })
  // Просим браузер разбудить service worker при сети — очередь доиграет даже с закрытым приложением.
  requestOutboxSync()
}

// ---------------------------------------------------------------------------
// Слияние ответа сервера с неотправленными операциями

function eventBody(op: PendingOp): Record<string, unknown> {
  return op.body ?? {}
}

/** Напоминания из тела операции: список минут или null (по умолчанию). */
const remindersOf = (v: unknown): number[] | null =>
  Array.isArray(v) ? v.filter((n): n is number => typeof n === 'number') : null

function mergeEvents(base: CalendarEvent[], ops: readonly PendingOp[], iso: string): CalendarEvent[] {
  const list = base.map((e) => ({ ...e }))
  const findIdx = (id: string) => list.findIndex((e) => e.id === id)
  for (const op of ops) {
    if (op.entity !== 'event') continue
    const body = eventBody(op)
    if (op.action === 'create') {
      if (body.date === iso) {
        list.push({
          id: op.entityId,
          title: String(body.title ?? ''),
          subtitle: typeof body.subtitle === 'string' ? body.subtitle : undefined,
          start: Number(body.start ?? 0),
          end: Number(body.end ?? 0),
          badge: (body.badge as CalendarEvent['badge']) ?? 'routine',
          highlight: true,
          reminders: remindersOf(body.reminders),
        })
      }
    } else if (op.action === 'update') {
      const i = findIdx(op.entityId)
      if (i >= 0) {
        // Правка перенесла событие в другой день или убрала этот день из серии — из списка оно уходит.
        if ((typeof body.date === 'string' && body.date !== iso && !list[i]?.repeat) || body.skip === iso) {
          list.splice(i, 1)
          continue
        }
        const e = list[i]!
        list[i] = {
          ...e,
          title: typeof body.title === 'string' ? body.title : e.title,
          subtitle: typeof body.subtitle === 'string' ? body.subtitle : e.subtitle,
          start: typeof body.start === 'number' ? body.start : e.start,
          end: typeof body.end === 'number' ? body.end : e.end,
          badge: (body.badge as CalendarEvent['badge']) ?? e.badge,
          reminders: 'reminders' in body ? remindersOf(body.reminders) : e.reminders,
        }
      }
    } else {
      const i = findIdx(op.entityId)
      if (i >= 0) list.splice(i, 1)
    }
  }
  return list.sort((a, b) => a.start - b.start)
}

function mergeTasks(base: Task[], ops: readonly PendingOp[]): Task[] {
  const list = base.map((t) => ({ ...t }))
  for (const op of ops) {
    if (op.entity !== 'task') continue
    const body = op.body ?? {}
    const i = list.findIndex((t) => t.id === op.entityId)
    if (op.action === 'create') {
      list.push({
        id: op.entityId,
        title: String(body.title ?? ''),
        subtitle: typeof body.subtitle === 'string' ? body.subtitle : undefined,
        kind: (body.kind as Task['kind']) ?? 'task',
        category: typeof body.category === 'string' ? body.category : undefined,
        due: typeof body.due === 'string' ? body.due : undefined,
        done: false,
      })
    } else if (op.action === 'update') {
      if (i >= 0) list[i] = { ...list[i]!, ...(body as Partial<Task>) }
    } else if (i >= 0) {
      list.splice(i, 1)
    }
  }
  return list
}

function mergeMonthDots(base: MonthDots, ops: readonly PendingOp[], year: number, month: number): MonthDots {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`
  const out: Record<number, CalendarEvent['badge'][]> = {}
  for (const [day, badges] of Object.entries(base)) out[Number(day)] = [...badges]
  for (const op of ops) {
    // У неотправленных событий месяца дорисовываем значок — как будто событие уже на сервере.
    if (op.entity !== 'event' || op.action !== 'create') continue
    const date = op.body?.date
    if (typeof date !== 'string' || !date.startsWith(prefix)) continue
    const day = Number(date.slice(prefix.length))
    if (!Number.isInteger(day) || day < 1 || day > 31) continue
    const badge = (op.body?.badge as CalendarEvent['badge']) ?? 'routine'
    const list = (out[day] ??= [])
    if (!list.includes(badge)) list.push(badge)
  }
  return out
}

// ---------------------------------------------------------------------------
// Обёртка

export function withOfflineQueue(api: CalendarApi, baseUrl = ''): CalendarApi {
  flushBase = baseUrl
  const ops = async () => (await outbox()).list()

  return {
    ...api,

    async getEvents(date) {
      const iso = toISODate(date)
      let base: CalendarEvent[]
      try {
        base = await api.getEvents(date)
      } catch (e) {
        if (!isNetError(e)) throw e
        base = []
      }
      return mergeEvents(base, await ops(), iso)
    },

    async createEvent(input) {
      try {
        return await api.createEvent(input)
      } catch (e) {
        if (!isNetError(e)) throw e
      }
      const tempId = newTempId()
      const date = toISODate(input.date)
      await enqueue({
        entity: 'event',
        action: 'create',
        entityId: tempId,
        tempId,
        method: 'POST',
        path: '/api/events',
        body: { ...input, date },
        // Повторная отправка: если первый запрос дошёл без ответа, событие уже на сервере.
        dedupe: { path: `/api/events?date=${date}`, match: ['title', 'start', 'end'] },
      })
      return {
        id: tempId,
        title: input.title,
        subtitle: input.subtitle,
        start: input.start,
        end: input.end,
        badge: input.badge ?? 'routine',
        highlight: true,
        date: input.date,
        reminders: input.reminders ?? null,
      }
    },

    async updateEvent(id, patch: EventPatch) {
      try {
        return await api.updateEvent(id, patch)
      } catch (e) {
        if (!isNetError(e)) throw e
      }
      const body: Record<string, unknown> = { ...patch }
      if (patch.date) body.date = toISODate(patch.date)
      if (patch.occurrence) body.occurrence = toISODate(patch.occurrence)
      if (patch.skip) body.skip = toISODate(patch.skip)
      // Правки серии не склеиваются: второй «убрать день» затёр бы первый, а перенос — свой occurrence.
      const separate = patch.skip !== undefined || patch.occurrence !== undefined
      await enqueue({
        entity: 'event',
        action: 'update',
        entityId: id,
        method: 'PATCH',
        path: '/api/events/:id',
        body,
        separate,
      })
      // Возврат не используется: оптимистичный кэш уже обновил onMutate в useUpdateEvent.
      return { id, ...patch } as DatedEvent
    },

    async deleteEvent(id) {
      try {
        return await api.deleteEvent(id)
      } catch (e) {
        if (!isNetError(e)) throw e
      }
      await enqueue({ entity: 'event', action: 'delete', entityId: id, method: 'DELETE', path: '/api/events/:id' })
    },

    async getTasks() {
      let base: Task[]
      try {
        base = await api.getTasks()
      } catch (e) {
        if (!isNetError(e)) throw e
        base = []
      }
      return mergeTasks(base, await ops())
    },

    async createTask(input: NewTask) {
      try {
        return await api.createTask(input)
      } catch (e) {
        if (!isNetError(e)) throw e
      }
      const tempId = newTempId()
      await enqueue({
        entity: 'task',
        action: 'create',
        entityId: tempId,
        tempId,
        method: 'POST',
        path: '/api/tasks',
        body: { ...input },
        dedupe: { path: '/api/tasks', match: ['title'] },
      })
      return {
        id: tempId,
        title: input.title,
        subtitle: input.subtitle,
        kind: input.kind ?? 'task',
        category: input.category,
        due: input.due,
        done: false,
      }
    },

    async updateTask(id, patch: TaskPatch) {
      try {
        return await api.updateTask(id, patch)
      } catch (e) {
        if (!isNetError(e)) throw e
      }
      await enqueue({
        entity: 'task',
        action: 'update',
        entityId: id,
        method: 'PATCH',
        path: '/api/tasks/:id',
        body: { ...patch },
      })
      return { id, ...patch } as Task
    },

    async deleteTask(id) {
      try {
        return await api.deleteTask(id)
      } catch (e) {
        if (!isNetError(e)) throw e
      }
      await enqueue({ entity: 'task', action: 'delete', entityId: id, method: 'DELETE', path: '/api/tasks/:id' })
    },

    async getMonthDots(year, month) {
      let base: MonthDots
      try {
        base = await api.getMonthDots(year, month)
      } catch (e) {
        if (!isNetError(e)) throw e
        base = {}
      }
      return mergeMonthDots(base, await ops(), year, month)
    },
  }
}

// ---------------------------------------------------------------------------
// Доступ для UI: счётчик ожидания и ручной запуск повтора.

let cachedCount = 0
let countWatching = false
const listeners = new Set<() => void>()

function watchCount(): void {
  if (countWatching) return
  countWatching = true
  void outbox()
    .then((o) => {
      const update = () => {
        cachedCount = o.list().length
        listeners.forEach((fn) => fn())
      }
      update()
      o.subscribe(update)
    })
    // Без IndexedDB (тесты, приватный режим) очередь просто не устойчива к перезапуску.
    .catch(() => {})
}

/** Сколько изменений ещё не уехало на сервер. */
export function pendingCount(): number {
  watchCount()
  return cachedCount
}

export function subscribePending(fn: () => void): () => void {
  watchCount()
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Повтор очереди; true — что-то реально уехало на сервер (надо обновить кэши). */
export async function flushOutboxNow(): Promise<boolean> {
  const r = await (await outbox()).flush(flushBase)
  return r.synced + r.dropped > 0
}

/** Перечитать очередь с диска — после повтора в service worker память страницы устарела. */
export async function reloadOutbox(): Promise<void> {
  await (await outbox()).reload()
}
