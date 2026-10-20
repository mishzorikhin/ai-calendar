import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatedEvent } from '../domain/types'
import { createHttpApi } from './http'
import { setOutboxForTests, withOfflineQueue } from './offline'
import { createMemoryBackend, isTempId, openOutbox, type Outbox } from './outbox'

const netDown = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Promise.reject(new TypeError('fetch failed'))),
  )
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

let outbox: Outbox

beforeEach(async () => {
  outbox = await openOutbox(createMemoryBackend())
  setOutboxForTests(Promise.resolve(outbox))
})

afterEach(() => vi.unstubAllGlobals())

const api = () => withOfflineQueue(createHttpApi(''), '')

describe('withOfflineQueue: мутации офлайн', () => {
  it('createEvent: синтетическое событие с временным id, операция в очереди', async () => {
    netDown()
    const e = await api().createEvent({ title: 'Звонок', date: new Date(2026, 9, 21), start: 540, end: 570 })
    expect(isTempId(e.id)).toBe(true)
    expect(e).toMatchObject({ title: 'Звонок', start: 540, end: 570, badge: 'routine' })
    const ops = outbox.list()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ entity: 'event', action: 'create', method: 'POST', path: '/api/events' })
    expect(ops[0]?.body).toMatchObject({ title: 'Звонок', date: '2026-10-21' })
  })

  it('updateEvent/deleteEvent: запросы встают в очередь', async () => {
    netDown()
    await api().updateEvent('evt-1', { title: 'Новое', start: 600 })
    await api().deleteEvent('evt-2')
    const ops = outbox.list()
    expect(ops.map((o) => `${o.action} ${o.entityId}`)).toEqual(['update evt-1', 'delete evt-2'])
    expect(ops[0]?.body).toMatchObject({ title: 'Новое', start: 600 })
  })

  it('серверная ошибка 400 не складывается в очередь — пробрасывается', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'Название обязательно' }, 400)),
    )
    await expect(
      api().createEvent({ title: '', date: new Date(2026, 9, 21), start: 60, end: 90 }),
    ).rejects.toMatchObject({ status: 400 })
    expect(outbox.list()).toHaveLength(0)
  })
})

describe('withOfflineQueue: чтение с неотправленными операциями', () => {
  const base: DatedEvent[] = [
    { id: 'evt-1', title: 'Старое', start: 60, end: 90, badge: 'work', date: new Date(2026, 9, 21) },
  ]

  it('getEvents: офлайн-вставка видна поверх ответа сервера', async () => {
    netDown()
    const a = api()
    await a.createEvent({ title: 'Офлайн', date: new Date(2026, 9, 21), start: 300, end: 330 })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(base.map(({ date: _d, ...e }) => ({ ...e, date: '2026-10-21' })))),
    )
    const events = await a.getEvents(new Date(2026, 9, 21))
    expect(events.map((e) => [e.id, e.title])).toEqual([
      ['evt-1', 'Старое'],
      [expect.stringMatching(/^offline-/), 'Офлайн'],
    ])
  })

  it('getEvents: отложенные правка и удаление применяются к списку', async () => {
    netDown()
    const a = api()
    await a.updateEvent('evt-1', { title: 'Переименовано', start: 120 })
    await a.deleteEvent('evt-2')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json([
          { id: 'evt-1', title: 'Старое', start: 60, end: 90, badge: 'work', date: '2026-10-21' },
          { id: 'evt-2', title: 'Удалить', start: 200, end: 230, badge: 'food', date: '2026-10-21' },
        ]),
      ),
    )
    const events = await a.getEvents(new Date(2026, 9, 21))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ id: 'evt-1', title: 'Переименовано', start: 120 })
  })

  it('getEvents: без сервера и кэша пустой день показывает только отложенное', async () => {
    netDown()
    const a = api()
    await a.createEvent({ title: 'Офлайн', date: new Date(2026, 9, 21), start: 60, end: 90 })
    const events = await a.getEvents(new Date(2026, 9, 21))
    expect(events).toHaveLength(1)
    expect(events[0]?.title).toBe('Офлайн')
  })

  it('getTasks: отложенное создание и галочка видны офлайн', async () => {
    netDown()
    const a = api()
    await a.createTask({ title: 'Купить молоко' })
    await a.updateTask('task-1', { done: true })
    const tasks = await a.getTasks()
    const created = tasks.find((t) => isTempId(t.id))
    expect(created).toMatchObject({ title: 'Купить молоко', kind: 'task', done: false })
    expect(tasks.find((t) => t.id === 'task-1')).toBeUndefined() // в базе её нет — мержить не во что
  })

  it('getMonthDots: значок отложенного события дорисовывается', async () => {
    netDown()
    const a = api()
    await a.createEvent({ title: 'Офлайн', date: new Date(2026, 9, 21), start: 60, end: 90, badge: 'sport' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ '5': ['work'] })),
    )
    const dots = await a.getMonthDots(2026, 9)
    expect(dots).toEqual({ 5: ['work'], 21: ['sport'] })
  })
})
