import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type ChatEvent } from './api'
import { createHttpApi } from './http'
import { getSession, setSession } from './session'

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(status === 204 ? undefined : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  setSession(null)
})

describe('http api', () => {
  it('переводит дату события в тип фронтенда', async () => {
    mockFetch(201, { id: 'evt-1', date: '2026-10-21', title: 'Звонок', start: 540, end: 630, badge: 'work' })
    const e = await createHttpApi().createEvent({
      title: 'Звонок',
      date: new Date(2026, 9, 21),
      start: 540,
      end: 630,
    })
    expect(e.date).toEqual(new Date(2026, 9, 21))
    expect(e.title).toBe('Звонок')
  })

  it('отправляет дату в формате ГГГГ-ММ-ДД', async () => {
    const fetch = mockFetch(200, [])
    await createHttpApi('http://api').getEvents(new Date(2026, 0, 5))
    expect(fetch).toHaveBeenCalledWith('http://api/api/events?date=2026-01-05', expect.anything())
  })

  it('чат читает SSE-стрим по фреймам', async () => {
    const sse =
      'data: {"type":"delta","text":"При"}\n\n' +
      'data: {"type":"tool","name":"create_event","status":"run"}\n\n' +
      'data: {"type":"delta","text":"вет"}\n\n' +
      'data: {"type":"done"}\n\n'
    const fetch = vi.fn(async () => new Response(sse, { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const events: ChatEvent[] = []
    await createHttpApi().sendChat('привет', (e) => events.push(e))
    expect(events.map((e) => e.type)).toEqual(['open', 'delta', 'tool', 'delta', 'done'])
    expect(events.flatMap((e) => (e.type === 'delta' ? [e.text] : [])).join('')).toBe('Привет')
    expect(fetch).toHaveBeenCalledWith('/api/chat', expect.objectContaining({ method: 'POST' }))
  })

  it('обрыв потока после приёма — ошибка «связь оборвалась», а не «не отправлено»', async () => {
    let reads = 0
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (reads++ === 0) c.enqueue(new TextEncoder().encode('data: {"type":"delta","text":"Нач"}\n\n'))
        else c.error(new TypeError('network'))
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200 })),
    )
    const events: ChatEvent[] = []
    await expect(createHttpApi().sendChat('x', (e) => events.push(e))).rejects.toEqual(
      new ApiError(0, 'Связь оборвалась во время ответа'),
    )
    expect(events.map((e) => e.type)).toEqual(['open', 'delta'])
  })

  it('отмена чтения чата (ушли с экрана) — без ошибки', async () => {
    const ctl = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        ctl.abort()
        throw new DOMException('aborted', 'AbortError')
      }),
    )
    await expect(createHttpApi().sendChat('x', () => {}, ctl.signal)).resolves.toBeUndefined()
  })

  it('ошибка чата приходит как ApiError', async () => {
    mockFetch(400, { error: 'Текст обязателен' })
    await expect(createHttpApi().sendChat('x', () => {})).rejects.toEqual(new ApiError(400, 'Текст обязателен'))
  })

  it('показывает текст ошибки сервера', async () => {
    mockFetch(409, { error: 'Время задано неверно' })
    await expect(createHttpApi().createEvent({ title: 'x', date: new Date(), start: 60, end: 0 })).rejects.toEqual(
      new ApiError(409, 'Время задано неверно'),
    )
  })

  it('числовые ключи месяца', async () => {
    mockFetch(200, { '8': ['work', 'food'] })
    expect(await createHttpApi().getMonthDots(2026, 9)).toEqual({ 8: ['work', 'food'] })
  })
})

describe('сессия', () => {
  const user = { id: 1, username: 'alice', name: 'Алиса' }

  it('регистрация сохраняет сессию, токен едет в Authorization', async () => {
    const fetch = vi.fn(
      async (_url: unknown, _init?: RequestInit) =>
        new Response(JSON.stringify({ user, token: 'tok-1' }), { status: 201 }),
    )
    vi.stubGlobal('fetch', fetch)
    const s = await createHttpApi().register({ username: 'alice', password: 'secret1' })
    expect(s.token).toBe('tok-1')
    expect(getSession()?.user.username).toBe('alice')

    fetch.mockImplementation(async () => new Response('[]', { status: 200 }))
    await createHttpApi().getTasks()
    const init = fetch.mock.calls.at(-1)?.[1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1')
  })

  it('вход возвращает сессию, выход её снимает', async () => {
    mockFetch(200, { user, token: 'tok-2' })
    await createHttpApi().login({ username: 'alice', password: 'secret1' })
    expect(getSession()?.token).toBe('tok-2')
    mockFetch(204, null)
    await createHttpApi().logout()
    expect(getSession()).toBeNull()
  })

  it('401 разлогинивает: данные больше не показываем', async () => {
    mockFetch(200, { user, token: 'tok-3' })
    await createHttpApi().login({ username: 'alice', password: 'secret1' })
    mockFetch(401, { error: 'Сессия истекла' })
    await expect(createHttpApi().getTasks()).rejects.toThrow(ApiError)
    expect(getSession()).toBeNull()
  })

  it('поиск людей и участники задачи бьют в новые маршруты', async () => {
    const fetchUsers = mockFetch(200, [{ id: 2, username: 'bob', name: 'Боб' }])
    const users = await createHttpApi().searchUsers('bo')
    expect(users[0]?.username).toBe('bob')
    expect(fetchUsers).toHaveBeenCalledWith('/api/users?q=bo', expect.anything())

    const fetchMember = mockFetch(200, { id: 'task-1', title: 'x', kind: 'task', done: false })
    await createHttpApi().addTaskMember('task-1', 'bob')
    expect(fetchMember).toHaveBeenCalledWith(
      '/api/tasks/task-1/members',
      expect.objectContaining({ method: 'POST', body: '{"username":"bob"}' }),
    )
  })

  it('не тащит служебные поля сервера в событие и сохраняет источник', async () => {
    mockFetch(200, [
      {
        id: 'evt-2',
        date: '2026-10-21',
        title: 'Планёрка',
        start: 540,
        end: 600,
        badge: 'work',
        source: 'cal-1',
        readOnly: true,
        externalId: '/calendars/alice/work/m1.ics',
        etag: '"e1"',
        userId: 1,
      },
    ])
    const [e] = await createHttpApi().getEvents(new Date(2026, 9, 21))
    expect(e).toMatchObject({ id: 'evt-2', source: 'cal-1', readOnly: true })
    expect(e).not.toHaveProperty('externalId')
    expect(e).not.toHaveProperty('etag')
  })

  it('подключение календаря и поиск CalDAV ходят в нужные маршруты', async () => {
    const fetch = mockFetch(200, { calendars: [{ url: 'https://dav/x/', name: 'Работа', writable: true }] })
    const api = createHttpApi()
    const cals = await api.discoverCalDav({ url: 'https://caldav.yandex.ru', username: 'a', password: 'p' })
    expect(cals).toHaveLength(1)
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/integrations/caldav/discover',
      expect.objectContaining({ method: 'POST' }),
    )

    mockFetch(204, null)
    await api.deleteIntegration('cal-1')
    const del = mockFetch(200, { id: 'cal-1' })
    await api.syncIntegration('cal-1')
    expect(del).toHaveBeenLastCalledWith('/api/integrations/cal-1/sync', expect.objectContaining({ method: 'POST' }))
  })

  it('ссылка на ленту — абсолютная, выключенная — null', async () => {
    mockFetch(200, { path: '' })
    expect(await createHttpApi().getFeed()).toBeNull()
    mockFetch(200, { path: '/api/feed/abc.ics' })
    expect(await createHttpApi('https://cal.example.com').resetFeed()).toBe('https://cal.example.com/api/feed/abc.ics')
  })

  it('пояс браузера обновляет пользователя в сессии', async () => {
    setSession({ token: 't', user: { id: 1, username: 'alice', name: 'Alice' } })
    mockFetch(200, { id: 1, username: 'alice', name: 'Alice', timeZone: 'Asia/Tokyo' })
    await createHttpApi().setTimeZone('Asia/Tokyo')
    expect(getSession()?.user.timeZone).toBe('Asia/Tokyo')
  })

  it('уведомления: ключ, настройки, подписка и отписка', async () => {
    const fetch = mockFetch(200, {
      publicKey: 'BKEY',
      settings: { eventReminder: 10, taskTime: 540, digest: -1 },
      devices: 1,
    })
    const api = createHttpApi()
    expect((await api.getPush()).publicKey).toBe('BKEY')
    expect(fetch).toHaveBeenLastCalledWith('/api/push', expect.anything())

    mockFetch(200, { eventReminder: 30, taskTime: 540, digest: -1 })
    expect(await api.updateNotifySettings({ eventReminder: 30 })).toMatchObject({ eventReminder: 30 })

    const sub = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } }
    const subscribe = mockFetch(204, null)
    await api.subscribePush(sub)
    expect(subscribe).toHaveBeenCalledWith(
      '/api/push/subscriptions',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(sub) }),
    )
    const unsubscribe = mockFetch(204, null)
    await api.unsubscribePush(sub.endpoint)
    expect(unsubscribe).toHaveBeenCalledWith(
      '/api/push/subscriptions',
      expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) }),
    )
    mockFetch(200, { sent: 2 })
    expect(await api.testPush()).toBe(2)
  })

  it('напоминания события: null с сервера — «по умолчанию», PATCH передаёт null как есть', async () => {
    mockFetch(200, [
      { id: 'evt-1', date: '2026-10-21', title: 'Звонок', start: 540, end: 600, badge: 'work', reminders: null },
    ])
    const [e] = await createHttpApi().getEvents(new Date(2026, 9, 21))
    expect(e?.reminders).toBeNull()
    const fetch = mockFetch(200, {
      id: 'evt-1',
      date: '2026-10-21',
      title: 'Звонок',
      start: 540,
      end: 600,
      badge: 'work',
      reminders: null,
    })
    await createHttpApi().updateEvent('evt-1', { reminders: null })
    expect(fetch).toHaveBeenCalledWith('/api/events/evt-1', expect.objectContaining({ body: '{"reminders":null}' }))
  })

  it('свои напоминания и устройства', async () => {
    const api = createHttpApi()
    const create = mockFetch(201, { id: 1, at: '2026-10-20T15:00:00Z', text: 'Позвонить', kind: 'reminder' })
    await api.createAlarm({ text: 'Позвонить', at: new Date('2026-10-20T15:00:00Z') })
    expect(create).toHaveBeenCalledWith(
      '/api/reminders',
      expect.objectContaining({ method: 'POST', body: '{"text":"Позвонить","at":"2026-10-20T15:00:00.000Z"}' }),
    )
    const del = mockFetch(204, null)
    await api.deleteAlarm(7)
    expect(del).toHaveBeenCalledWith('/api/reminders/7', expect.objectContaining({ method: 'DELETE' }))
    mockFetch(200, [{ id: 'ab12', label: 'Chrome · Android', createdAt: '2026-10-20T10:00:00Z' }])
    expect((await api.getDevices())[0]?.label).toBe('Chrome · Android')
    const delDevice = mockFetch(204, null)
    await api.deleteDevice('ab12')
    expect(delDevice).toHaveBeenCalledWith('/api/push/devices/ab12', expect.objectContaining({ method: 'DELETE' }))
  })

  it('правка вхождения серии: даты occurrence и skip в формате ГГГГ-ММ-ДД', async () => {
    const fetch = mockFetch(200, {
      id: 'evt-1',
      date: '2026-10-21',
      title: 'Йога',
      start: 1140,
      end: 1200,
      badge: 'sport',
    })
    await createHttpApi().updateEvent('evt-1', {
      date: new Date(2026, 10, 11),
      occurrence: new Date(2026, 10, 10),
      skip: new Date(2026, 10, 3),
    })
    expect(fetch).toHaveBeenCalledWith(
      '/api/events/evt-1',
      expect.objectContaining({ body: '{"date":"2026-11-11","occurrence":"2026-11-10","skip":"2026-11-03"}' }),
    )
  })
})
