/**
 * Офлайн-очередь мутаций: запросы, которые не ушли до сервера, складываются в IndexedDB
 * и повторяются, когда появляется сеть. Модуль одинаково работает на странице и внутри
 * service worker — весь ввод-вывод только через fetch и IndexedDB.
 *
 * Операция хранит и «семантику» (entity/action/entityId — для склейки и показа в UI),
 * и готовый HTTP-запрос (method/path/body) для повторной отправки.
 */

export type OpEntity = 'event' | 'task'
export type OpAction = 'create' | 'update' | 'delete'

export type PendingOp = {
  /** Порядковый номер: IndexedDB autoIncrement, задаёт порядок повтора (FIFO). */
  seq?: number
  entity: OpEntity
  action: OpAction
  /** Id сущности: реальный или временный `offline-*` у только что созданной. */
  entityId: string
  /** Временный id у create-операции; после повтора заменяется на серверный через idmap. */
  tempId?: string
  method: 'POST' | 'PATCH' | 'DELETE'
  /** Путь запроса; в update/delete вместо id стоит `:id` — подставляется при повторе. */
  path: string
  body?: Record<string, unknown>
  /**
   * Для create: перед повтором запрашиваем коллекцию и ищем совпадение по `match`-полям.
   * Нужно, когда исходный запрос дошёл до сервера, но ответ потерялся вместе с сетью —
   * иначе повтор создаст дубль.
   */
  dedupe?: { path: string; match: readonly string[] }
  at: number
  /** id пользователя, сделавшего правку: повтор идёт только от его имени. Нет — операция старой версии. */
  owner?: string
  /**
   * Правка, которую нельзя склеивать с другими: «убрать день из серии» и перенос вхождения
   * зависят от своих полей (skip, occurrence), и склейка подменила бы одно другим.
   */
  separate?: boolean
}

/** Хранилище очереди: IndexedDB в браузере/worker, память — в тестах. */
export interface OutboxBackend {
  list(): Promise<PendingOp[]>
  add(op: PendingOp): Promise<PendingOp>
  update(seq: number, patch: Partial<PendingOp>): Promise<void>
  remove(seq: number): Promise<void>
  /** Привязка временного id созданной сущности к серверному. */
  setId(tempId: string, realId: string): Promise<void>
  /** Серверный id сущности или сам id, если он не временный. */
  resolveId(id: string): Promise<string>
  /** Мелкие метаданные очереди (токен сессии): общие для страницы и service worker. */
  getMeta(key: string): Promise<string | null>
  setMeta(key: string, value: string | null): Promise<void>
  /** Стереть операции и привязки id (метаданные остаются). */
  clear(): Promise<void>
}

// ---------------------------------------------------------------------------
// Бэкенд в памяти (тесты, окружения без IndexedDB)

export function createMemoryBackend(): OutboxBackend {
  const ops: PendingOp[] = []
  const idmap = new Map<string, string>()
  const meta = new Map<string, string>()
  let seq = 0
  return {
    list: () => Promise.resolve([...ops]),
    add(op) {
      const stored = { ...op, seq: ++seq }
      ops.push(stored)
      return Promise.resolve(stored)
    },
    update(s, patch) {
      const i = ops.findIndex((o) => o.seq === s)
      if (i >= 0) ops[i] = { ...ops[i]!, ...patch }
      return Promise.resolve()
    },
    remove(s) {
      const i = ops.findIndex((o) => o.seq === s)
      if (i >= 0) ops.splice(i, 1)
      return Promise.resolve()
    },
    setId: (t, r) => (idmap.set(t, r), Promise.resolve()),
    resolveId: (id) => Promise.resolve(idmap.get(id) ?? id),
    getMeta: (k) => Promise.resolve(meta.get(k) ?? null),
    setMeta: (k, v) => (v === null ? meta.delete(k) : meta.set(k, v), Promise.resolve()),
    clear() {
      ops.splice(0)
      idmap.clear()
      return Promise.resolve()
    },
  }
}

// ---------------------------------------------------------------------------
// Бэкенд на IndexedDB

const DB_NAME = 'ai-calendar'
const DB_VERSION = 2
const OPS_STORE = 'outbox'
const IDS_STORE = 'idmap'
const META_STORE = 'meta'

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB error'))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB tx error'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB tx aborted'))
  })
}

export function createIdbBackend(dbName = DB_NAME): OutboxBackend {
  let dbp: Promise<IDBDatabase> | null = null
  const db = () => {
    dbp ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = globalThis.indexedDB.open(dbName, DB_VERSION)
      req.onupgradeneeded = () => {
        const d = req.result
        if (!d.objectStoreNames.contains(OPS_STORE))
          d.createObjectStore(OPS_STORE, { keyPath: 'seq', autoIncrement: true })
        if (!d.objectStoreNames.contains(IDS_STORE)) d.createObjectStore(IDS_STORE, { keyPath: 'temp' })
        if (!d.objectStoreNames.contains(META_STORE)) d.createObjectStore(META_STORE, { keyPath: 'k' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open error'))
    })
    return dbp
  }
  const store = async (name: string, mode: IDBTransactionMode) => (await db()).transaction(name, mode).objectStore(name)
  return {
    async list() {
      const ops = await requestToPromise((await store(OPS_STORE, 'readonly')).getAll() as IDBRequest<PendingOp[]>)
      return ops.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    },
    async add(op) {
      const tx = (await db()).transaction(OPS_STORE, 'readwrite')
      const seq = await requestToPromise(tx.objectStore(OPS_STORE).add(op))
      await txDone(tx)
      return { ...op, seq: Number(seq) }
    },
    async update(seq, patch) {
      const tx = (await db()).transaction(OPS_STORE, 'readwrite')
      const s = tx.objectStore(OPS_STORE)
      const cur = await requestToPromise(s.get(seq) as IDBRequest<PendingOp | undefined>)
      if (cur) await requestToPromise(s.put({ ...cur, ...patch }))
      await txDone(tx)
    },
    async remove(seq) {
      const tx = (await db()).transaction(OPS_STORE, 'readwrite')
      tx.objectStore(OPS_STORE).delete(seq)
      await txDone(tx)
    },
    async setId(temp, real) {
      const tx = (await db()).transaction(IDS_STORE, 'readwrite')
      tx.objectStore(IDS_STORE).put({ temp, real })
      await txDone(tx)
    },
    async resolveId(id) {
      const row = await requestToPromise(
        (await store(IDS_STORE, 'readonly')).get(id) as IDBRequest<{ real: string } | undefined>,
      )
      return row?.real ?? id
    },
    async getMeta(key) {
      const row = await requestToPromise(
        (await store(META_STORE, 'readonly')).get(key) as IDBRequest<{ v: string } | undefined>,
      )
      return row?.v ?? null
    },
    async setMeta(key, value) {
      const tx = (await db()).transaction(META_STORE, 'readwrite')
      if (value === null) tx.objectStore(META_STORE).delete(key)
      else tx.objectStore(META_STORE).put({ k: key, v: value })
      await txDone(tx)
    },
    async clear() {
      const tx = (await db()).transaction([OPS_STORE, IDS_STORE], 'readwrite')
      tx.objectStore(OPS_STORE).clear()
      tx.objectStore(IDS_STORE).clear()
      await txDone(tx)
    },
  }
}

// ---------------------------------------------------------------------------
// Очередь: склейка операций, повтор, подписка на изменения

export type FlushResult = { synced: number; dropped: number; remaining: number }

export interface Outbox {
  /** Текущие операции в порядке повтора. */
  list(): readonly PendingOp[]
  enqueue(op: PendingOp): Promise<void>
  /**
   * Повторяет очередь по порядку. Сетевой сбой или ответ 5xx останавливают обход
   * (повторим позже), ответ 4xx выкидывает операцию — она не «заживёт» сама.
   */
  flush(baseUrl?: string): Promise<FlushResult>
  /** Перечитать хранилище — после replay из service worker память страницы расходится с диском. */
  reload(): Promise<void>
  /** Сохранить токен сессии для повторов из service worker (localStorage ему недоступен). */
  setAuthToken(token: string | null): Promise<void>
  /** Сохранённый токен сессии — для запросов из service worker (кнопки в уведомлениях). */
  authToken(): Promise<string | null>
  /**
   * Чья это очередь. Вошёл другой пользователь — операции прошлого стираются: иначе
   * они уехали бы на сервер с его токеном, в чужой календарь. Выход (null) очередь
   * не трогает — тот же человек войдёт снова и доиграет свои правки.
   * adopt — операции без владельца (от версии до этой правки) достаются ему, а не стираются:
   * так делают только при запуске с уже открытой сессией — правки почти наверняка её.
   */
  setOwner(userId: string | null, adopt?: boolean): Promise<void>
  subscribe(fn: () => void): () => void
}

class StopFlush extends Error {}
class DropOp extends Error {}

export async function openOutbox(backend: OutboxBackend): Promise<Outbox> {
  let ops = await backend.list()
  let owner = await backend.getMeta(META_OWNER)
  let flushing = false
  /** Операция, которая сейчас летит на сервер: дописывать в неё и снимать её нельзя. */
  let inFlight: PendingOp | null = null
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((fn) => fn())

  const sameTarget = (o: PendingOp, entity: OpEntity, entityId: string) =>
    o.entity === entity && o.entityId === entityId

  const mergeUpdate = async (target: PendingOp, body: Record<string, unknown>) => {
    target.body = { ...target.body, ...body }
    if (target.seq !== undefined) await backend.update(target.seq, { body: target.body })
  }

  const removeOp = async (op: PendingOp) => {
    ops = ops.filter((o) => o !== op)
    if (op.seq !== undefined) await backend.remove(op.seq)
  }

  const outbox: Outbox = {
    list: () => ops,

    async enqueue(op) {
      // Правка неотправленного create или прошлой правки — дописываем поля в её тело.
      if (op.action === 'update' && op.body && !op.separate) {
        const target = ops.find(
          (o) => o !== inFlight && o.action !== 'delete' && !o.separate && sameTarget(o, op.entity, op.entityId),
        )
        if (target) {
          await mergeUpdate(target, op.body)
          emit()
          return
        }
      }
      // Удаление снимает правки; если сущность ещё не уезжала на сервер — отменяет и создание.
      // Летящий create остаётся: он дойдёт до сервера, и удаление должно пойти следом.
      if (op.action === 'delete') {
        const pending = ops.filter((o) => o !== inFlight && sameTarget(o, op.entity, op.entityId))
        for (const p of pending) await removeOp(p)
        if (pending.some((o) => o.action === 'create')) {
          emit()
          return
        }
      }
      const stored = await backend.add({ ...op, owner: op.owner ?? owner ?? undefined })
      ops = [...ops, stored]
      emit()
    },

    async flush(baseUrl = '') {
      if (flushing) return { synced: 0, dropped: 0, remaining: ops.length }
      flushing = true
      const result: FlushResult = { synced: 0, dropped: 0, remaining: 0 }
      // Сессия на весь обход: живая со страницы или сохранённая в метаданных (service worker).
      const live = await getCredentials?.()
      const token = live?.token ?? (await backend.getMeta(META_TOKEN))
      const user = live?.userId ?? (await backend.getMeta(META_OWNER))
      try {
        for (;;) {
          const op = ops[0]
          if (!op) break
          // Чужая операция (вход сменился, а setOwner ещё не стёр очередь) с этим токеном не уходит.
          if (user !== null && (op.owner ?? owner) !== user) break
          inFlight = op
          const outcome = await replay(op, backend, baseUrl, token).finally(() => (inFlight = null))
          if (outcome === 'retry') break
          await removeOp(op)
          if (outcome === 'done') result.synced++
          else result.dropped++
        }
      } finally {
        flushing = false
        result.remaining = ops.length
        emit()
      }
      return result
    },

    async reload() {
      ops = await backend.list()
      emit()
    },

    setAuthToken: (token) => backend.setMeta(META_TOKEN, token),
    authToken: () => backend.getMeta(META_TOKEN),

    async setOwner(userId, adopt = false) {
      if (userId === null || userId === owner) return
      // Источник правды — IndexedDB: её делят вкладки, и другая могла уже сменить владельца.
      const stored = await backend.getMeta(META_OWNER)
      owner = userId
      if (stored === userId) {
        ops = await backend.list()
      } else if (!(stored === null && adopt)) {
        ops = []
        await backend.clear()
      }
      emit()
      if (stored !== userId) await backend.setMeta(META_OWNER, userId)
    },

    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  return outbox
}

// ---------------------------------------------------------------------------
// Повтор одной операции

type Outcome = 'done' | 'drop' | 'retry'

// Токен сессии для повторов. На странице отдаётся живым getter-ом (http.ts),
// а для service worker сессия дополнительно пишется в метаданные очереди —
// localStorage в worker-контексте недоступен, IndexedDB у них общий.
const META_TOKEN = 'authToken'
/** id пользователя, чьи операции лежат в очереди. */
const META_OWNER = 'owner'
type Credentials = { token: string; userId: string } | null | undefined
let getCredentials: (() => Credentials | Promise<Credentials>) | null = null

/** Подключить источник сессии (токен и id пользователя) — вызывает приложение один раз при старте. */
export function setCredentialsGetter(fn: () => Credentials | Promise<Credentials>): void {
  getCredentials = fn
}

async function send(
  baseUrl: string,
  method: string,
  path: string,
  body: Record<string, unknown> | undefined,
  token: string | null,
) {
  const headers: Record<string, string> = {}
  if (body) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`
  let res: Response
  try {
    res = await fetch(baseUrl + path, {
      method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new StopFlush()
  }
  // DELETE/PATCH по уже удалённому — считаем выполненным: цель достигнута.
  if (res.status === 404 && method !== 'POST') return null
  // 401 — сессия умерла или её нет в этом контексте: повторим позже, операцию сохраняем.
  if (res.status >= 500 || res.status === 401) throw new StopFlush()
  if (!res.ok) throw new DropOp(`${method} ${path}: ${res.status}`)
  if (res.status === 204) return null
  return (await res.json().catch(() => null)) as unknown
}

async function replay(op: PendingOp, backend: OutboxBackend, baseUrl: string, token: string | null): Promise<Outcome> {
  try {
    if (op.action === 'create') {
      let realId: string | undefined
      // Запрос мог дойти до сервера без ответа — сначала ищем след в коллекции.
      if (op.dedupe) {
        const list = (await send(baseUrl, 'GET', op.dedupe.path, undefined, token)) as Record<string, unknown>[] | null
        const found = Array.isArray(list)
          ? list.find((item) => op.dedupe!.match.every((f) => item[f] === op.body?.[f]))
          : undefined
        realId = typeof found?.id === 'string' ? found.id : undefined
      }
      if (!realId) {
        const created = (await send(baseUrl, 'POST', op.path, op.body, token)) as { id?: unknown } | null
        if (typeof created?.id !== 'string') throw new DropOp('create: ответ без id')
        realId = created.id
      }
      if (op.tempId) await backend.setId(op.tempId, realId)
      return 'done'
    }
    const realId = await backend.resolveId(op.entityId)
    await send(baseUrl, op.method, op.path.replace(':id', encodeURIComponent(realId)), op.body, token)
    return 'done'
  } catch (e) {
    if (e instanceof StopFlush) return 'retry'
    if (e instanceof DropOp) return 'drop'
    throw e
  }
}

// ---------------------------------------------------------------------------
// Синглтон очереди и уведомления

let current: Promise<Outbox> | null = null

/** Общая очередь приложения: страница и service worker держат по одной на свой контекст. */
export function getOutbox(backend?: OutboxBackend): Promise<Outbox> {
  current ??= openOutbox(backend ?? createIdbBackend())
  return current
}

/** Временный id сущности, которая ещё не уезжала на сервер. */
export function newTempId(): string {
  return `offline-${crypto.randomUUID()}`
}

export function isTempId(id: string): boolean {
  return id.startsWith('offline-')
}

// ---------------------------------------------------------------------------
// Background Sync: браузер разбудит service worker при сети, даже если приложение закрыто.
// Не поддержан в Safari/Firefox — там очередь доигрывает страница по событию online/запуску.

export const SYNC_TAG = 'ai-calendar:outbox'

interface SyncRegistration extends ServiceWorkerRegistration {
  sync?: { register(tag: string): Promise<void> }
}

export function requestOutboxSync(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  void navigator.serviceWorker.ready
    .then((reg) => void (reg as SyncRegistration).sync?.register(SYNC_TAG).catch(() => {}))
    .catch(() => {})
}
