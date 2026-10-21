import { useSyncExternalStore } from 'react'
import type { Session } from './api'
import { getOutbox } from './outbox'

const KEY = 'ai-calendar:session:v1'

// Сессия живёт в localStorage: переживает перезагрузку и общая между вкладками
// браузера (выход в одной вкладке разлогинит остальные через событие storage).
let current: Session | null = load()
const listeners = new Set<() => void>()

// Уже открытая сессия тоже сразу уходит в очередь — иначе service worker
// останется без токена до первой смены сессии.
if (current) persistToken(current)

function load(): Session | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Session
    return parsed && typeof parsed.token === 'string' && parsed.user ? parsed : null
  } catch {
    return null
  }
}

export function getSession(): Session | null {
  return current
}

export function setSession(s: Session | null) {
  const previous = current
  current = s
  try {
    if (s) window.localStorage.setItem(KEY, JSON.stringify(s))
    else window.localStorage.removeItem(KEY)
  } catch {
    /* хранилище недоступно — сессия проживёт до перезагрузки вкладки */
  }
  persistToken(s)
  if (previous?.user.id !== s?.user.id) void clearApiCache()
  for (const fn of listeners) fn()
}

// Токен дублируем в IndexedDB очереди: service worker не видит localStorage,
// а для replay офлайн-мутаций по Background Sync токен нужен и без открытой страницы.
// Владелец очереди — чтобы правки одного аккаунта не уехали на сервер от имени другого.
function persistToken(s: Session | null) {
  void getOutbox()
    .then(async (o) => {
      await o.setOwner(s ? String(s.user.id) : null)
      await o.setAuthToken(s?.token ?? null)
    })
    .catch(() => {})
}

/**
 * Ответы API в кэше service worker (cacheName 'api' в sw.ts) хранятся по адресу, без учёта
 * пользователя: после выхода или смены аккаунта их нельзя показывать офлайн следующему.
 */
async function clearApiCache(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') await caches.delete('api')
  } catch {
    /* Cache Storage недоступен (не https, приватный режим) — кэшировать было и нечего */
  }
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Синхронизация между вкладками: другая вкладка пишет localStorage — обновляемся.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY || e.key === null) {
      const previous = current
      current = load()
      persistToken(current)
      if (previous?.user.id !== current?.user.id) void clearApiCache()
      for (const fn of listeners) fn()
    }
  })
}

/** Текущая сессия как React-значение: обновляется при входе/выходе/401. */
export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, getSession, () => null)
}
