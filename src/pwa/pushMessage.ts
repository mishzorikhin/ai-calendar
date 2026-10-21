/**
 * Содержимое уведомления от сервера (model.PushMessage) и то, как его показать.
 * Чистые функции: их использует service worker, тесты гоняются в Node.
 */

export type PushKind = 'event' | 'task' | 'digest' | 'share' | 'test' | 'reminder'

export type PushMessage = {
  kind: PushKind
  title: string
  body?: string
  /** Адрес в приложении: «/#day/2026-10-21». */
  url?: string
  /** Одно уведомление на событие: новое с тем же тегом заменяет прошлое. */
  tag?: string
  /** Для кнопки «Готово» у задачи. */
  taskId?: string
  /** Сколько встреч и задач осталось сегодня — число на иконке приложения. */
  badge?: number
}

const KINDS: readonly PushKind[] = ['event', 'task', 'digest', 'share', 'test', 'reminder']

/** На сколько откладывает кнопка «Позже»: встречу — на 10 минут, задачу — на час. */
export const SNOOZE_MINUTES: Record<PushKind, number> = {
  event: 10,
  task: 60,
  digest: 60,
  share: 60,
  test: 10,
  reminder: 10,
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

/** Разбирает данные push осторожно: битое сообщение всё равно показывается, а не теряется. */
export function parsePushMessage(raw: unknown): PushMessage {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const kind = KINDS.find((k) => k === o.kind) ?? 'test'
  // Открываем только страницы приложения — адрес «//чужой.сайт» или «https://…» не принимаем.
  const url = str(o.url)
  return {
    kind,
    title: str(o.title) ?? 'AI Календарь',
    body: str(o.body),
    url: url && url.startsWith('/') && !url.startsWith('//') ? url : '/',
    tag: str(o.tag),
    taskId: str(o.taskId),
    badge: typeof o.badge === 'number' && Number.isInteger(o.badge) && o.badge >= 0 ? o.badge : undefined,
  }
}

/**
 * Параметры showNotification сверх стандартных типов TS: вибрация, повторный сигнал
 * и «не убирать само» есть в браузерах, но не в lib.dom.
 */
export type ShowOptions = NotificationOptions & {
  vibrate?: number[]
  renotify?: boolean
  requireInteraction?: boolean
}

/**
 * Рисунок вибрации (мс: вибрация, пауза, вибрация…). Встреча — заметнее, остальное — коротко.
 * Работает на Android; iPhone вибрирует по системным настройкам звуков и не даёт задать рисунок.
 */
export const VIBRATION: Record<PushKind, number[]> = {
  event: [200, 100, 200, 100, 200],
  task: [200, 100, 200],
  digest: [120],
  share: [120, 80, 120],
  test: [200, 100, 200],
  reminder: [200, 100, 200, 100, 200],
}

/** Параметры showNotification: иконки берутся из сборки рядом с service worker. */
export function notificationOptions(msg: PushMessage): ShowOptions {
  return {
    body: msg.body,
    tag: msg.tag,
    data: msg,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    lang: 'ru',
    vibrate: VIBRATION[msg.kind],
    // Новое уведомление с тем же тегом (отложенное, перенос встречи) вибрирует снова, а не заменяет старое молча.
    renotify: msg.tag !== undefined,
    // Встреча «сейчас» и своё напоминание висят на экране компьютера, пока их не закроют.
    requireInteraction: msg.kind === 'reminder' || (msg.kind === 'event' && msg.body?.startsWith('Сейчас') === true),
  }
}

/** Кнопки уведомления (Android, Chrome на компьютере; iOS их не показывает). */
export function notificationActions(msg: PushMessage): { action: string; title: string }[] {
  switch (msg.kind) {
    case 'event':
    case 'reminder':
      return [{ action: 'snooze', title: 'Через 10 минут' }]
    case 'task':
      return msg.taskId
        ? [
            { action: 'done', title: 'Готово' },
            { action: 'snooze', title: 'Через час' },
          ]
        : [{ action: 'snooze', title: 'Через час' }]
    default:
      return []
  }
}

/**
 * Что прислать после «Отложить»: у встречи «Через 10 минут» к тому времени устареет,
 * поэтому относительное время убираем, а часы и место оставляем.
 */
export function snoozedMessage(msg: PushMessage): PushMessage {
  if (msg.kind !== 'event' || !msg.body) return msg
  const parts = msg.body.split(' · ')
  const rest = /^(Через|Сейчас)/.test(parts[0] ?? '') ? parts.slice(1) : parts
  return { ...msg, body: ['Отложенное напоминание', ...rest].join(' · ') }
}

/**
 * Показать уведомление внутри открытого приложения вместо системного. Без системного push
 * считается «тихим»: Chromium это допускает, когда окно сайта в фокусе, а Safari (и PWA на iPhone,
 * у которой в User-Agent нет даже «Safari/») и Firefox за такие отзывают подписку или урезают
 * квоту. Поэтому плашка — только в Chromium вне iOS (на iOS любой браузер — это WebKit).
 */
export function showInApp(userAgent: string, endpoint: string | undefined): boolean {
  // Подписка у Apple (iPad с «настольным» User-Agent выглядит как Mac) — это WebKit: только системное.
  if (!endpoint || /\.push\.apple\.com\//.test(endpoint)) return false
  const ios = /iPhone|iPad|iPod/.test(userAgent)
  return !ios && /Chrome\/|Chromium\//.test(userAgent)
}
