import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryBackend, openOutbox, type PendingOp } from './outbox'

const makeOp = (o: Partial<PendingOp>): PendingOp => ({
  entity: 'event',
  action: 'update',
  entityId: 'evt-1',
  method: 'PATCH',
  path: '/api/events/:id',
  at: 1,
  ...o,
})

const createOp = (entityId: string, body: Record<string, unknown>): PendingOp =>
  makeOp({
    action: 'create',
    entityId,
    tempId: entityId,
    method: 'POST',
    path: '/api/events',
    body,
    dedupe: { path: '/api/events?date=2026-10-21', match: ['title', 'start', 'end'] },
  })

const deleteOp = (entityId: string): PendingOp =>
  makeOp({ action: 'delete', entityId, method: 'DELETE', path: '/api/events/:id', body: undefined })

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

afterEach(() => vi.unstubAllGlobals())

async function freshOutbox() {
  return openOutbox(createMemoryBackend())
}

describe('outbox enqueue', () => {
  it('правка неотправленного create дописывается в его тело', async () => {
    const o = await freshOutbox()
    await o.enqueue(createOp('offline-1', { title: 'А', date: '2026-10-21', start: 60, end: 90 }))
    await o.enqueue(makeOp({ entityId: 'offline-1', body: { title: 'Б', start: 120 } }))
    const ops = o.list()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ action: 'create', body: { title: 'Б', start: 120, end: 90 } })
  })

  it('две правки одного события сливаются в одну', async () => {
    const o = await freshOutbox()
    await o.enqueue(makeOp({ body: { title: 'А' } }))
    await o.enqueue(makeOp({ body: { start: 300 } }))
    const ops = o.list()
    expect(ops).toHaveLength(1)
    expect(ops[0]?.body).toEqual({ title: 'А', start: 300 })
  })

  it('удаление неотправленного create отменяет операцию целиком', async () => {
    const o = await freshOutbox()
    await o.enqueue(createOp('offline-1', { title: 'А', date: '2026-10-21', start: 60, end: 90 }))
    await o.enqueue(deleteOp('offline-1'))
    expect(o.list()).toHaveLength(0)
  })

  it('удаление снимает отложенные правки и само встаёт в очередь', async () => {
    const o = await freshOutbox()
    await o.enqueue(makeOp({ body: { title: 'А' } }))
    await o.enqueue(deleteOp('evt-1'))
    const ops = o.list()
    expect(ops).toHaveLength(1)
    expect(ops[0]?.action).toBe('delete')
  })
})

describe('outbox flush', () => {
  it('dedupe + POST, серверный id сохраняется для будущих операций', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`)
        if (init?.method === 'POST') return json({ id: 'srv-9', title: 'А' }, 201)
        if (init?.method === 'PATCH') return json({ id: 'srv-9', title: 'Б' })
        return json([]) // dedupe GET: совпадений нет
      }),
    )
    const backend = createMemoryBackend()
    const o = await openOutbox(backend)
    await o.enqueue(createOp('offline-1', { title: 'А', date: '2026-10-21', start: 60, end: 90 }))
    expect(await o.flush()).toEqual({ synced: 1, dropped: 0, remaining: 0 })
    expect(calls).toEqual(['GET /api/events?date=2026-10-21', 'POST /api/events'])
    expect(await backend.resolveId('offline-1')).toBe('srv-9')

    // Правка, отложенная уже после replay create, идёт по серверному id.
    calls.length = 0
    await o.enqueue(makeOp({ entityId: 'offline-1', body: { title: 'Б' } }))
    expect(await o.flush()).toEqual({ synced: 1, dropped: 0, remaining: 0 })
    expect(calls).toEqual(['PATCH /api/events/srv-9'])
  })

  it('dedupe: запрос дошёл без ответа — повторный POST не делаем', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`)
        return json([{ id: 'srv-1', title: 'А', start: 60, end: 90, date: '2026-10-21' }])
      }),
    )
    const backend = createMemoryBackend()
    const o = await openOutbox(backend)
    await o.enqueue(createOp('offline-1', { title: 'А', date: '2026-10-21', start: 60, end: 90 }))
    expect((await o.flush()).synced).toBe(1)
    expect(calls).toEqual(['GET /api/events?date=2026-10-21'])
    expect(await backend.resolveId('offline-1')).toBe('srv-1')
  })

  it('сетевая ошибка останавливает обход и сохраняет остаток очереди', async () => {
    let n = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (++n === 1) return new Response(null, { status: 204 })
        throw new Error('network down')
      }),
    )
    const o = await freshOutbox()
    await o.enqueue(deleteOp('evt-1'))
    await o.enqueue(deleteOp('evt-9'))
    const r = await o.flush()
    expect(r).toMatchObject({ synced: 1, remaining: 1 })
    expect(o.list()[0]?.entityId).toBe('evt-9')
  })

  it('4xx выкидывает операцию и идёт дальше, 5xx останавливает обход', async () => {
    const statuses = [400, 204]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: statuses.shift() ?? 500 })),
    )
    const o = await freshOutbox()
    await o.enqueue(makeOp({ entityId: 'a' }))
    await o.enqueue(deleteOp('b'))
    const r = await o.flush()
    expect(r).toEqual({ synced: 1, dropped: 1, remaining: 0 })
  })

  it('404 на delete — цель достигнута', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    )
    const o = await freshOutbox()
    await o.enqueue(deleteOp('evt-1'))
    expect((await o.flush()).synced).toBe(1)
  })

  it('повтор идёт с токеном из метаданных очереди; живой getter важнее', async () => {
    let auth: string | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null
        return new Response(null, { status: 204 })
      }),
    )
    const o = await freshOutbox()
    await o.setAuthToken('tok-1')
    await o.enqueue(deleteOp('evt-1'))
    expect((await o.flush()).synced).toBe(1)
    expect(auth).toBe('Bearer tok-1')

    const { setCredentialsGetter } = await import('./outbox')
    await o.setOwner('7', true)
    setCredentialsGetter(() => ({ token: 'live-2', userId: '7' }))
    auth = null
    await o.enqueue(deleteOp('evt-2'))
    await o.flush()
    expect(auth).toBe('Bearer live-2')
    setCredentialsGetter(() => null)
  })

  it('401 останавливает обход — операции ждут свежего токена', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    )
    const o = await freshOutbox()
    await o.enqueue(deleteOp('evt-1'))
    expect(await o.flush()).toMatchObject({ synced: 0, remaining: 1 })
  })
})

describe('outbox owner', () => {
  it('вход другого пользователя стирает чужие операции, повторный вход того же — нет', async () => {
    const backend = createMemoryBackend()
    const o = await openOutbox(backend)
    await o.setOwner('1')
    await o.enqueue(deleteOp('evt-1'))
    await o.setOwner(null) // выход: правки ждут возвращения хозяина
    await o.setOwner('1')
    expect(o.list()).toHaveLength(1)
    await o.setOwner('2')
    expect(o.list()).toHaveLength(0)
    expect(await backend.list()).toHaveLength(0)
    // Владелец переживает перезапуск: новая очередь на том же хранилище помнит, чья она.
    await o.enqueue(deleteOp('evt-2'))
    const reopened = await openOutbox(backend)
    await reopened.setOwner('2')
    expect(reopened.list()).toHaveLength(1)
  })

  it('операции старой версии без владельца: запуск с сессией их забирает, новый вход — стирает', async () => {
    const legacy = async () => {
      const backend = createMemoryBackend()
      await backend.add(deleteOp('evt-1'))
      return openOutbox(backend)
    }
    const started = await legacy()
    await started.setOwner('1', true)
    expect(started.list()).toHaveLength(1)
    const loggedIn = await legacy()
    await loggedIn.setOwner('1')
    expect(loggedIn.list()).toHaveLength(0)
  })

  it('вторая вкладка с тем же хранилищем подхватывает смену владельца, а не стирает новые правки', async () => {
    const backend = createMemoryBackend()
    const tab1 = await openOutbox(backend)
    const tab2 = await openOutbox(backend)
    await tab1.setOwner('1')
    await tab2.setOwner('1')
    await tab1.setOwner('2')
    await tab1.enqueue(deleteOp('evt-b'))
    await tab2.setOwner('2') // событие storage во второй вкладке пришло позже
    expect(await backend.list()).toHaveLength(1)
    expect(tab2.list()).toEqual([expect.objectContaining({ entityId: 'evt-b', owner: '2' })])
  })

  it('чужие операции не уходят с токеном нового пользователя, даже пока очередь не стёрта', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    const { setCredentialsGetter } = await import('./outbox')
    const o = await freshOutbox()
    await o.setOwner('1')
    await o.enqueue(deleteOp('evt-1'))
    // Вошёл другой пользователь: сессия уже его, setOwner ещё не успел.
    setCredentialsGetter(() => ({ token: 'tok-2', userId: '2' }))
    expect(await o.flush()).toMatchObject({ synced: 0, remaining: 1 })
    expect(fetch).not.toHaveBeenCalled()
    setCredentialsGetter(() => null)
  })
})

describe('outbox in-flight', () => {
  /** fetch, где POST ждёт ручного release, а остальные запросы отвечают сразу и пишутся в calls. */
  function stubSlowPost() {
    const ctl = { release: null as ((r: Response) => void) | null, calls: [] as string[] }
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        ctl.calls.push(`${method} ${url}${init?.body ? ` ${String(init.body)}` : ''}`)
        if (method === 'POST') return new Promise<Response>((resolve) => (ctl.release = resolve))
        if (method === 'GET') return Promise.resolve(json([]))
        return Promise.resolve(json({ id: 'evt-77' }))
      }),
    )
    return ctl
  }

  it('правка во время отправки create не теряется, а уходит следом', async () => {
    const ctl = stubSlowPost()
    const o = await freshOutbox()
    await o.enqueue(createOp('offline-1', { title: 'А', date: '2026-10-21', start: 60, end: 90 }))
    const flushing = o.flush()
    await vi.waitFor(() => expect(ctl.release).not.toBeNull())
    // Create уже летит: правка не может дописаться в его тело — она отдельная операция.
    await o.enqueue(makeOp({ entityId: 'offline-1', body: { title: 'Б' } }))
    expect(o.list()).toHaveLength(2)
    ctl.release?.(json({ id: 'evt-77' }, 201))
    await flushing
    expect(o.list()).toHaveLength(0)
    expect(ctl.calls.at(-1)).toBe('PATCH /api/events/evt-77 {"title":"Б"}')
  })

  it('удаление во время отправки create не отменяет его, а уходит следом', async () => {
    const ctl = stubSlowPost()
    const o = await freshOutbox()
    await o.enqueue(createOp('offline-1', { title: 'А', date: '2026-10-21', start: 60, end: 90 }))
    const flushing = o.flush()
    await vi.waitFor(() => expect(ctl.release).not.toBeNull())
    await o.enqueue(deleteOp('offline-1'))
    ctl.release?.(json({ id: 'evt-5' }, 201))
    await flushing
    expect(o.list()).toHaveLength(0)
    expect(ctl.calls.at(-1)).toBe('DELETE /api/events/evt-5')
  })
})
