/**
 * Service worker приложения (injectManifest): precache сборки, SPA-fallback,
 * кэширование GET-запросов API, replay офлайн-очереди мутаций (src/api/outbox.ts)
 * по событию Background Sync — очередь доигрывает, даже когда приложение закрыто, —
 * и уведомления Web Push от своего сервера (напоминания, кнопки «Готово» и «Отложить»).
 */
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'
import { getOutbox, SYNC_TAG } from './api/outbox'
import {
  notificationActions,
  notificationOptions,
  parsePushMessage,
  SNOOZE_MINUTES,
  snoozedMessage,
  type PushMessage,
} from './pwa/pushMessage'

// В tsconfig нет lib WebWorker (конфликтовал бы с DOM) — описываем нужный минимум сами.
interface SyncEventLike {
  tag: string
  waitUntil(promise: Promise<unknown>): void
}
interface ClientLike {
  postMessage(message: unknown): void
}
interface WindowClientLike extends ClientLike {
  url: string
  focus(): Promise<WindowClientLike>
}
interface PushEventLike {
  data: { json(): unknown; text(): string } | null
  waitUntil(promise: Promise<unknown>): void
}
interface NotificationLike {
  data: unknown
  close(): void
}
interface NotificationEventLike {
  action: string
  notification: NotificationLike
  waitUntil(promise: Promise<unknown>): void
}
interface SubscriptionChangeEventLike {
  oldSubscription: PushSubscription | null
  newSubscription: PushSubscription | null
  waitUntil(promise: Promise<unknown>): void
}
declare global {
  interface Window {
    /** Точка инъекции precache-манифеста — workbox-build заменяет на список файлов. */
    __WB_MANIFEST: Array<string | { url: string; revision: string | null }>
  }
}
interface SwScope {
  skipWaiting(): void
  location: { origin: string }
  registration: {
    showNotification(
      title: string,
      options?: NotificationOptions & { actions?: { action: string; title: string }[] },
    ): Promise<void>
    pushManager: PushManager
  }
  clients: {
    matchAll(options?: { type?: 'window'; includeUncontrolled?: boolean }): Promise<WindowClientLike[]>
    openWindow(url: string): Promise<WindowClientLike | null>
  }
  addEventListener(type: 'sync', listener: (e: SyncEventLike) => void): void
  addEventListener(type: 'message', listener: (e: { data?: { type?: string } }) => void): void
  addEventListener(type: 'push', listener: (e: PushEventLike) => void): void
  addEventListener(type: 'notificationclick', listener: (e: NotificationEventLike) => void): void
  addEventListener(type: 'pushsubscriptionchange', listener: (e: SubscriptionChangeEventLike) => void): void
}
const sw = self as unknown as SwScope

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// SPA-навигация на index.html; API живёт своей жизнью.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//] }))

// Не кэшируем: health, разовые ответы входа через Google/Microsoft и ленту .ics (секрет в адресе).
const NO_CACHE = [/^\/api\/health$/, /^\/api\/integrations\/oauth\//, /^\/api\/feed\/./]

// Данные API: свежие из сети, офлайн — последний ответ из кэша. Кэш общий для аккаунтов,
// поэтому приложение стирает его при выходе и смене пользователя (api/session.ts).
registerRoute(
  ({ url, request }) =>
    url.pathname.startsWith('/api/') && !NO_CACHE.some((re) => re.test(url.pathname)) && request.method === 'GET',
  new NetworkFirst({
    cacheName: 'api',
    networkTimeoutSeconds: 4,
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 24 * 3600 })],
  }),
  'GET',
)

registerRoute(
  ({ url }) => url.origin === 'https://images.unsplash.com',
  new CacheFirst({
    cacheName: 'images',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 30 * 24 * 3600 }),
    ],
  }),
)

// Обновление по кнопке «Обновить» (workbox-window шлёт SKIP_WAITING).
sw.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') sw.skipWaiting()
})

/** Повтор очереди и уведомление открытых вкладок — они перечитают данные и очередь. */
async function flushAndNotify(): Promise<void> {
  const outbox = await getOutbox()
  // Очередь в памяти worker-а могла устареть: страница добавляла операции или стёрла чужие.
  await outbox.reload()
  const result = await outbox.flush('')
  if (result.synced + result.dropped === 0) return
  for (const client of await sw.clients.matchAll()) {
    client.postMessage({ type: 'outbox:flushed' })
  }
}

sw.addEventListener('sync', (e) => {
  if (e.tag === SYNC_TAG) e.waitUntil(flushAndNotify())
})

// --- Уведомления --------------------------------------------------------------

sw.addEventListener('push', (e) => {
  let raw: unknown = null
  try {
    raw = e.data?.json() ?? null
  } catch {
    raw = { title: e.data?.text() }
  }
  const msg = parsePushMessage(raw)
  // Показываем всегда: «тихий» push браузеры наказывают (Safari отзывает подписку).
  e.waitUntil(
    sw.registration.showNotification(msg.title, {
      ...notificationOptions(msg),
      actions: notificationActions(msg),
    }),
  )
})

/** Запрос к API от имени пользователя: токен — из метаданных офлайн-очереди. */
async function apiFetch(path: string, method: string, body: unknown): Promise<boolean> {
  const token = await (await getOutbox()).authToken()
  if (!token) return false
  try {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Открыть приложение на нужном экране: уже открытое окно — переключить, иначе — открыть новое. */
async function openApp(url: string): Promise<void> {
  const target = new URL(url, sw.location.origin)
  const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const existing = windows.find((w) => new URL(w.url).origin === target.origin)
  if (existing) {
    // Фокус может не дать браузер (нет жеста пользователя) — переход на экран всё равно отправляем.
    await existing.focus().catch(() => existing)
    existing.postMessage({ type: 'push:open', url: target.pathname + target.search + target.hash })
    return
  }
  await sw.clients.openWindow(target.href)
}

/** Сообщить открытым окнам, что данные поменялись (задачу отметили из уведомления). */
async function notifyClients(type: string): Promise<void> {
  for (const client of await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
    client.postMessage({ type })
  }
}

async function handleAction(action: string, msg: PushMessage): Promise<void> {
  if (action === 'done' && msg.taskId) {
    const ok = await apiFetch(`/api/tasks/${encodeURIComponent(msg.taskId)}`, 'PATCH', { done: true })
    if (ok) return notifyClients('push:changed')
    // Не вышло (нет сети или сессии) — открываем приложение, отметить можно там.
    return openApp(msg.url ?? '/')
  }
  if (action === 'snooze') {
    const ok = await apiFetch('/api/push/snooze', 'POST', {
      minutes: SNOOZE_MINUTES[msg.kind],
      message: snoozedMessage(msg),
    })
    if (!ok) return openApp(msg.url ?? '/')
    return
  }
  return openApp(msg.url ?? '/')
}

sw.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const msg = parsePushMessage(e.notification.data)
  e.waitUntil(handleAction(e.action, msg))
})

// Браузер сменил подписку (истекла или ключи обновились) — подписываемся заново тем же
// ключом сервера и сообщаем новый адрес; старый забываем.
sw.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(
    (async () => {
      const key = e.oldSubscription?.options.applicationServerKey
      const next =
        e.newSubscription ??
        (key ? await sw.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null)
      if (e.oldSubscription)
        await apiFetch('/api/push/subscriptions', 'DELETE', { endpoint: e.oldSubscription.endpoint })
      if (next) await apiFetch('/api/push/subscriptions', 'POST', next.toJSON())
    })(),
  )
})
