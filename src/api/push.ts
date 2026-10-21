import type { PushSubscriptionData } from '../domain/types'
import type { CalendarApi } from './api'

/**
 * Подписка этого браузера на уведомления Web Push. Сервис доставки выбирает браузер
 * (FCM, Mozilla, Apple), но содержимое шифруется для устройства, а подписывает его
 * ключ нашего сервера — внешних аккаунтов и ключей у приложения нет.
 *
 * Подписка привязана к аккаунту, который её включил (OWNER_KEY): при выходе она
 * снимается, а если на устройстве вошёл другой человек, старая подписка не переходит к нему молча.
 */
const OWNER_KEY = 'ai-calendar:push-owner'

/** Что мешает уведомлениям на этом устройстве. */
export type PushSupport =
  | 'ok'
  /** Браузер не умеет Web Push. */
  | 'unsupported'
  /** iPhone/iPad: уведомления только у приложения, добавленного на экран «Домой». */
  | 'ios-install'
  /** Нет service worker: dev-сервер или однофайловая сборка. */
  | 'no-worker'

function isIos(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export async function pushSupport(): Promise<PushSupport> {
  if (typeof window === 'undefined') return 'unsupported'
  if (isIos() && !isStandalone()) return 'ios-install'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined)
  return reg ? 'ok' : 'no-worker'
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  return (await navigator.serviceWorker.getRegistration().catch(() => undefined)) ?? null
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration()
  return (await reg?.pushManager.getSubscription().catch(() => null)) ?? null
}

/** base64url → байты (applicationServerKey). */
export function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Подписка сделана с тем же ключом сервера (после смены ключа старая бесполезна). */
function sameKey(sub: PushSubscription, publicKey: string): boolean {
  const key = sub.options.applicationServerKey
  if (!key) return false
  const a = new Uint8Array(key)
  const b = base64UrlToBytes(publicKey)
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function setOwner(userId: number | null): void {
  try {
    if (userId === null) localStorage.removeItem(OWNER_KEY)
    else localStorage.setItem(OWNER_KEY, String(userId))
  } catch {
    /* без localStorage подписка просто не запомнит владельца */
  }
}

function owner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY)
  } catch {
    return null
  }
}

/** Включить уведомления на этом устройстве: разрешение, подписка браузера, сохранение на сервере. */
export async function enablePush(api: CalendarApi, publicKey: string, userId: number): Promise<void> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Уведомления запрещены в настройках браузера'
        : 'Разрешите уведомления, чтобы их включить',
    )
  }
  const reg = await registration()
  if (!reg) throw new Error('Уведомления работают в установленном приложении')
  let sub = await reg.pushManager.getSubscription()
  if (sub && !sameKey(sub, publicKey)) {
    await sub.unsubscribe()
    sub = null
  }
  try {
    sub ??= await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(publicKey),
    })
  } catch (e) {
    // Тексты браузера («Registration failed - push service error») пользователю не помогут.
    throw new Error(
      e instanceof DOMException && e.name === 'NotAllowedError'
        ? 'Браузер не дал подписаться — в режиме инкогнито уведомления не работают'
        : 'Сервис уведомлений браузера не ответил — проверьте соединение и попробуйте ещё раз',
      { cause: e },
    )
  }
  await api.subscribePush(sub.toJSON() as PushSubscriptionData)
  setOwner(userId)
}

/** Выключить уведомления на этом устройстве. Сервер может быть недоступен — подписку браузера снимаем всё равно. */
export async function disablePush(api: CalendarApi): Promise<void> {
  const sub = await currentSubscription()
  setOwner(null)
  if (!sub) return
  await api.unsubscribePush(sub.endpoint).catch(() => {})
  await sub.unsubscribe().catch(() => false)
}

/**
 * Сверка при запуске: подписка этого аккаунта — напоминаем о ней серверу (он мог её забыть
 * после ответа 410 или смены ключа); подписка другого аккаунта — снимаем.
 * Возвращает, включены ли уведомления на устройстве для userId.
 */
export async function syncPush(api: CalendarApi, publicKey: string, userId: number): Promise<boolean> {
  const sub = await currentSubscription()
  if (!sub) return false
  if (owner() !== String(userId)) {
    // Включал кто-то другой (сессия истекла без выхода) — его уведомления сюда больше не идут.
    await sub.unsubscribe().catch(() => false)
    setOwner(null)
    return false
  }
  if (!sameKey(sub, publicKey) || Notification.permission !== 'granted') {
    await disablePush(api)
    return false
  }
  await api.subscribePush(sub.toJSON() as PushSubscriptionData)
  return true
}

/** id этого устройства в списке: начало sha256 адреса подписки, как deviceID на сервере. */
export async function currentDeviceId(): Promise<string | null> {
  const sub = await currentSubscription()
  if (!sub || typeof crypto === 'undefined' || !crypto.subtle) return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.endpoint))
  return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
