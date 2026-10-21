/**
 * Service worker приложения (injectManifest): precache сборки, SPA-fallback,
 * кэширование GET-запросов API и replay офлайн-очереди мутаций (src/api/outbox.ts)
 * по событию Background Sync — очередь доигрывает, даже когда приложение закрыто.
 */
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'
import { getOutbox, SYNC_TAG } from './api/outbox'

// В tsconfig нет lib WebWorker (конфликтовал бы с DOM) — описываем нужный минимум сами.
interface SyncEventLike {
  tag: string
  waitUntil(promise: Promise<unknown>): void
}
interface ClientLike {
  postMessage(message: unknown): void
}
declare global {
  interface Window {
    /** Точка инъекции precache-манифеста — workbox-build заменяет на список файлов. */
    __WB_MANIFEST: Array<string | { url: string; revision: string | null }>
  }
}
interface SwScope {
  skipWaiting(): void
  clients: { matchAll(): Promise<ClientLike[]> }
  addEventListener(type: 'sync', listener: (e: SyncEventLike) => void): void
  addEventListener(type: 'message', listener: (e: { data?: { type?: string } }) => void): void
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
