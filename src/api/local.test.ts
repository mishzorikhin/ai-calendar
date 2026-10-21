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
    await first.sendChat('Привет', () => {})

    const second = createLocalApi(storage)
    expect((await second.getEvents(day)).some((e) => e.title === 'Звонок маме')).toBe(true)
    expect((await second.getMessages()).at(-2)?.text).toBe('Привет')
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

    await expect(api.sendChat('   ', () => {})).rejects.toMatchObject({ status: 400 })
    await expect(api.sendChat('я'.repeat(2001), () => {})).rejects.toMatchObject({ status: 400 })
  })

  it('без сервера календари не подключаются, а список пуст', async () => {
    const api = createLocalApi(new MemoryStorage())
    expect(await api.getIntegrations()).toEqual({ items: [], providers: { google: false, outlook: false } })
    expect(await api.getFeed()).toBeNull()
    await expect(api.createIntegration({ kind: 'ics', url: 'https://x/a.ics' })).rejects.toBeInstanceOf(ApiError)
    await expect(api.startOAuth('google')).rejects.toBeInstanceOf(ApiError)
  })

  it('напоминания события: проверка, порядок, null — по умолчанию', async () => {
    const api = createLocalApi(new MemoryStorage())
    const e = await api.createEvent({ title: 'Врач', date: day, start: 900, end: 960, reminders: [10, 60, 10] })
    expect(e.reminders).toEqual([60, 10])
    expect((await api.createEvent({ title: 'Обед', date: day, start: 720, end: 780 })).reminders).toBeNull()
    await expect(
      api.createEvent({ title: 'x', date: day, start: 600, end: 660, reminders: [-5] }),
    ).rejects.toBeInstanceOf(ApiError)
    expect((await api.updateEvent(e.id, { reminders: [] })).reminders).toEqual([])
    expect((await api.updateEvent(e.id, { title: 'Стоматолог' })).reminders).toEqual([])
    expect((await api.updateEvent(e.id, { reminders: null })).reminders).toBeNull()
    await expect(api.updateEvent(e.id, { reminders: [1, 2, 3, 4] })).rejects.toMatchObject({ status: 400 })
  })

  it('уведомления: настройки хранятся, подписаться без сервера нельзя', async () => {
    const storage = new MemoryStorage()
    const api = createLocalApi(storage)
    const info = await api.getPush()
    expect(info).toEqual({
      publicKey: null,
      settings: { eventReminder: 10, taskTime: 540, digest: -1, evening: -1, quietFrom: -1, quietTo: -1 },
      devices: 0,
    })
    expect(await api.updateNotifySettings({ digest: 480 })).toMatchObject({ digest: 480, eventReminder: 10 })
    await expect(api.updateNotifySettings({ taskTime: 1440 })).rejects.toMatchObject({ status: 400 })
    await expect(api.updateNotifySettings({ eventReminder: -2 })).rejects.toMatchObject({ status: 400 })
    expect((await createLocalApi(storage).getPush()).settings.digest).toBe(480)
    await expect(api.testPush()).rejects.toBeInstanceOf(ApiError)
    await expect(
      api.subscribePush({ endpoint: 'https://push.example/1', keys: { p256dh: 'x', auth: 'y' } }),
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('повторяющиеся события: вхождения, перенос серии, «только этот день»', async () => {
    const api = createLocalApi(new MemoryStorage())
    const yoga = await api.createEvent({
      title: 'Йога',
      date: new Date(2026, 9, 20),
      start: 1140,
      end: 1200,
      badge: 'sport',
      repeat: 'weekly',
    })
    const on = async (d: Date) => (await api.getEvents(d)).filter((e) => e.title === 'Йога')
    expect(await on(new Date(2026, 10, 3))).toHaveLength(1)
    expect(await on(new Date(2026, 10, 4))).toHaveLength(0)
    expect((await api.getMonthDots(2026, 10))[3]).toContain('sport')

    await api.updateEvent(yoga.id, { skip: new Date(2026, 10, 3) })
    expect(await on(new Date(2026, 10, 3))).toHaveLength(0)

    await api.updateEvent(yoga.id, { occurrence: new Date(2026, 10, 10), date: new Date(2026, 10, 11) })
    expect(await on(new Date(2026, 10, 11))).toHaveLength(1)
    expect(await on(new Date(2026, 9, 20))).toHaveLength(0)

    await expect(
      api.createEvent({ title: 'x', date: day, start: 60, end: 120, repeat: 'daily', repeatUntil: '2026-01-01' }),
    ).rejects.toMatchObject({ status: 400 })
    const plain = await api.createEvent({ title: 'Разово', date: day, start: 60, end: 120 })
    await expect(api.updateEvent(plain.id, { skip: day })).rejects.toMatchObject({ status: 400 })

    await api.updateEvent(yoga.id, { repeat: '' })
    expect(await on(new Date(2026, 10, 18))).toHaveLength(0)
  })

  it('сдвиг серии двигает конец и убранные дни; снятый повтор остаётся в дне вхождения', async () => {
    const api = createLocalApi(new MemoryStorage())
    const pool = await api.createEvent({
      title: 'Бассейн',
      date: new Date(2026, 9, 20),
      start: 600,
      end: 660,
      repeat: 'weekly',
      repeatUntil: '2026-11-24',
    })
    await api.updateEvent(pool.id, { skip: new Date(2026, 10, 3) })
    const moved = await api.updateEvent(pool.id, { occurrence: new Date(2026, 10, 10), date: new Date(2026, 10, 11) })
    expect(moved).toMatchObject({ repeatUntil: '2026-11-25', exdates: ['2026-11-04'] })
    const on = async (d: Date) => (await api.getEvents(d)).filter((e) => e.title === 'Бассейн')
    expect(await on(new Date(2026, 10, 4))).toHaveLength(0)
    expect(await on(new Date(2026, 10, 25))).toHaveLength(1)
    const single = await api.updateEvent(pool.id, {
      occurrence: new Date(2026, 10, 18),
      date: new Date(2026, 10, 18),
      repeat: '',
    })
    expect(single.date).toEqual(new Date(2026, 10, 18))
    expect(single.repeat).toBeUndefined()
    await expect(api.updateNotifySettings({ quietFrom: 1380 })).rejects.toMatchObject({ status: 400 })
  })

  it('новые настройки уведомлений проверяются как на сервере', async () => {
    const api = createLocalApi(new MemoryStorage())
    expect(
      await api.updateNotifySettings({ quietFrom: 1380, quietTo: 420, badgeReminders: { sport: 60 } }),
    ).toMatchObject({
      quietFrom: 1380,
      badgeReminders: { sport: 60 },
    })
    await expect(api.updateNotifySettings({ evening: 1440 })).rejects.toMatchObject({ status: 400 })
    await expect(api.updateNotifySettings({ badgeReminders: { sport: -3 } })).rejects.toMatchObject({ status: 400 })
    expect(await api.getAlarms()).toEqual([])
    await expect(api.createAlarm({ text: 'x', at: new Date() })).rejects.toBeInstanceOf(ApiError)
  })
})
