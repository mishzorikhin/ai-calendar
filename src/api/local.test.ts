import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { createLocalApi } from './local'

class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  clear() {
    this.map.clear()
  }
  getItem(key: string) {
    return this.map.get(key) ?? null
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
}

const day = new Date(2026, 9, 21)

describe('local api', () => {
  it('событие пользователя появляется в дне и месяце', async () => {
    const api = createLocalApi(new MemoryStorage())
    await api.createEvent({ title: 'Звонок маме', date: day, start: 600, end: 660, badge: 'work' })

    const events = await api.getEvents(day)
    expect(events.some((e) => e.title === 'Звонок маме')).toBe(true)
    expect((await api.getMonthDots(2026, 9))[21]).toContain('work')
  })

  it('отклоняет пустое название и неверное время', async () => {
    const api = createLocalApi(new MemoryStorage())
    await expect(api.createEvent({ title: '  ', date: day, start: 600, end: 660 })).rejects.toBeInstanceOf(ApiError)
    await expect(api.createEvent({ title: 'x', date: day, start: 660, end: 600 })).rejects.toBeInstanceOf(ApiError)
  })

  it('сохраняет данные между запусками', async () => {
    const storage = new MemoryStorage()
    const first = createLocalApi(storage)
    await first.createEvent({ title: 'Звонок маме', date: day, start: 600, end: 660 })
    await first.addMessage('user', 'Привет')

    const second = createLocalApi(storage)
    expect((await second.getEvents(day)).some((e) => e.title === 'Звонок маме')).toBe(true)
    expect((await second.getMessages()).at(-1)?.text).toBe('Привет')
  })

  it('чат без сервера отвечает заглушкой и сохраняет реплики', async () => {
    const api = createLocalApi(new MemoryStorage())
    const events: string[] = []
    await api.sendChat('привет', (e) => events.push(e.type))
    expect(events.at(-1)).toBe('done')
    const messages = await api.getMessages()
    expect(messages.at(-2)).toMatchObject({ role: 'user', text: 'привет' })
    expect(messages.at(-1)?.role).toBe('ai')
  })

  it('проверяет длины и диапазон времени так же, как сервер', async () => {
    const api = createLocalApi(new MemoryStorage())
    const event = { date: day, start: 600, end: 660 }
    await expect(api.createEvent({ ...event, title: 'я'.repeat(121) })).rejects.toMatchObject({ status: 400 })
    await expect(api.createEvent({ ...event, title: 'x', subtitle: 'я'.repeat(201) })).rejects.toMatchObject({
      status: 400,
    })
    await expect(api.createEvent({ ...event, title: 'x', end: 1500 })).rejects.toMatchObject({ status: 400 })
    await expect(api.createEvent({ ...event, title: 'x', start: -5 })).rejects.toMatchObject({ status: 400 })
    await expect(api.createTask({ title: 'x', subtitle: 'я'.repeat(201) })).rejects.toMatchObject({ status: 400 })

    const created = await api.createEvent({ ...event, title: 'x' })
    await expect(api.updateEvent(created.id, { title: '  ' })).rejects.toMatchObject({ status: 400 })
    await expect(api.updateEvent(created.id, { end: 2000 })).rejects.toMatchObject({ status: 400 })

    await expect(api.addMessage('user', '   ')).rejects.toMatchObject({ status: 400 })
    await expect(api.addMessage('user', 'я'.repeat(2001))).rejects.toMatchObject({ status: 400 })
    await expect(api.sendChat('я'.repeat(2001), () => {})).rejects.toMatchObject({ status: 400 })
  })

  it('без сервера календари не подключаются, а список пуст', async () => {
    const api = createLocalApi(new MemoryStorage())
    expect(await api.getIntegrations()).toEqual({ items: [], providers: { google: false, outlook: false } })
    expect(await api.getFeed()).toBeNull()
    await expect(api.createIntegration({ kind: 'ics', url: 'https://x/a.ics' })).rejects.toBeInstanceOf(ApiError)
    await expect(api.startOAuth('google')).rejects.toBeInstanceOf(ApiError)
  })
})
