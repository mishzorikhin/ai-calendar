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
    const again = await api.createEvent({
      title: 'x',
      date: new Date(2026, 9, 20),
      start: 60,
      end: 90,
      repeat: 'daily',
    })
    await expect(
      api.updateEvent(again.id, {
        skip: new Date(2026, 9, 21),
        occurrence: new Date(2026, 9, 22),
        date: new Date(2026, 9, 23),
      }),
    ).rejects.toMatchObject({ status: 400 })
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

  it('событие на весь день: время 0–1440, можно вернуть время', async () => {
    const api = createLocalApi(new MemoryStorage())
    const e = await api.createEvent({ title: 'Переезд', date: day, start: 600, end: 660, allDay: true })
    expect(e).toMatchObject({ allDay: true, start: 0, end: 1440 })
    expect((await api.getEvents(day)).find((x) => x.id === e.id)?.allDay).toBe(true)
    const timed = await api.updateEvent(e.id, { allDay: false, start: 540, end: 600 })
    expect(timed).toMatchObject({ start: 540, end: 600 })
    expect(timed.allDay).toBeUndefined()
    expect(await api.updateEvent(e.id, { allDay: true })).toMatchObject({ allDay: true, start: 0, end: 1440 })
  })

  it('профиль: по умолчанию, патч с проверкой как на сервере, переживает перезапуск', async () => {
    const storage = new MemoryStorage()
    const api = createLocalApi(storage)
    expect((await api.getProfile()).onboarded).toBe(false)
    const p = await api.updateProfile({ workStart: 600, workDays: [5, 1, 1], onboarded: true })
    expect(p.workDays).toEqual([1, 5])
    await expect(api.updateProfile({ workEnd: 500 })).rejects.toBeInstanceOf(ApiError)
    const again = await createLocalApi(storage).getProfile()
    expect(again.workStart).toBe(600)
    expect(again.onboarded).toBe(true)
  })

  it('память и люди: добавление, правка, догадка «нет» пропадает, удаление', async () => {
    const api = createLocalApi(new MemoryStorage())
    const m = await api.createMemory({ kind: 'date', text: ' ДР мамы ', date: '--03-14' })
    expect(m.text).toBe('ДР мамы')
    await expect(api.createMemory({ kind: 'other', text: '' })).rejects.toBeInstanceOf(ApiError)
    await expect(api.createMemory({ kind: 'other', text: 'x', date: '14.03' })).rejects.toBeInstanceOf(ApiError)
    expect((await api.updateMemory(m.id, { text: 'День рождения мамы' })).text).toBe('День рождения мамы')
    await api.updateMemory(m.id, { rejected: true })
    expect(await api.getMemories()).toEqual([])

    const gleb = await api.createPerson({ name: ' Глеб ', aliases: ['Глебушка'], username: '@Gleb' })
    await api.createPerson({ name: 'анна' })
    expect((await api.getPeople()).map((p) => p.name)).toEqual(['анна', 'Глеб'])
    expect(gleb.username).toBe('gleb')
    await expect(api.createPerson({ name: 'x', meetingMinutes: 5 })).rejects.toBeInstanceOf(ApiError)
    expect((await api.updatePerson(gleb.id, { name: 'Глеб', place: 'Кофейня' })).aliases).toBeUndefined()
    await api.deletePerson(gleb.id)
    await expect(api.deletePerson(gleb.id)).rejects.toBeInstanceOf(ApiError)
  })

  it('многодневное событие видно в каждом дне, заметки и ссылка сохраняются', async () => {
    const api = createLocalApi(new MemoryStorage())
    await api.createEvent({
      title: 'Конференция',
      date: new Date(2026, 9, 21),
      endDate: '2026-10-23',
      start: 600,
      end: 1080,
      url: 'https://conf.example',
      notes: ' Бейдж ',
    })
    const mid = (await api.getEvents(new Date(2026, 9, 22))).find((e) => e.title === 'Конференция')
    expect(mid).toMatchObject({ allDay: true, url: 'https://conf.example', notes: 'Бейдж' })
    expect(mid?.span?.start).toBe(600)
    expect((await api.getEvents(new Date(2026, 9, 24))).some((e) => e.title === 'Конференция')).toBe(false)
    await expect(
      api.createEvent({ title: 'x', date: day, start: 600, end: 660, url: 'ftp://x' }),
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('поиск: по названию, месту и заметкам, без регистра и «ё», серия — ближайшим днём', async () => {
    const api = createLocalApi(new MemoryStorage())
    const today = new Date()
    const past = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 20)
    await api.createEvent({ title: 'Йога с ГЛЕБОМ', date: past, start: 540, end: 600, repeat: 'weekly' })
    await api.createEvent({ title: 'Обед', subtitle: 'Кафе у Глёба', date: past, start: 780, end: 840 })
    await api.createTask({ title: 'Подарок Глебу' })
    const res = await api.search('глеб')
    expect(res.events.map((e) => e.title)).toEqual(['Йога с ГЛЕБОМ', 'Обед'])
    expect(res.events[0]!.date >= new Date(today.getFullYear(), today.getMonth(), today.getDate())).toBe(true)
    expect(res.tasks).toHaveLength(1)
    await expect(api.search('г')).rejects.toBeInstanceOf(ApiError)
  })

  it('оценка задачи и событие под задачу — как на сервере', async () => {
    const api = createLocalApi(new MemoryStorage())
    const task = await api.createTask({ title: 'Отчёт', estimate: 90 })
    expect(task.estimate).toBe(90)
    await expect(api.createTask({ title: 'x', estimate: 5 })).rejects.toBeInstanceOf(ApiError)
    expect((await api.updateTask(task.id, { estimate: 0 })).estimate).toBeUndefined()
    const ev = await api.createEvent({ title: 'Отчёт', date: day, start: 540, end: 630, taskId: task.id })
    expect(ev.taskId).toBe(task.id)
    await expect(
      api.createEvent({ title: 'x', date: day, start: 540, end: 600, taskId: 'нет' }),
    ).rejects.toBeInstanceOf(ApiError)
    expect(await api.getSuggestions()).toEqual([])
  })
})
