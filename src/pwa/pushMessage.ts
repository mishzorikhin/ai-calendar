/**
 * Содержимое уведомления от сервера (model.PushMessage) и то, как его показать.
 * Чистые функции: их использует service worker, тесты гоняются в Node.
 */

export type PushKind = 'event' | 'task' | 'digest' | 'share' | 'test'

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
}

const KINDS: readonly PushKind[] = ['event', 'task', 'digest', 'share', 'test']

/** На сколько откладывает кнопка «Позже»: встречу — на 10 минут, задачу — на час. */
export const SNOOZE_MINUTES: Record<PushKind, number> = { event: 10, task: 60, digest: 60, share: 60, test: 10 }

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
  }
}

/** Параметры showNotification: иконки берутся из сборки рядом с service worker. */
export function notificationOptions(msg: PushMessage): NotificationOptions {
  return {
    body: msg.body,
    tag: msg.tag,
    data: msg,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    lang: 'ru',
  }
}

/** Кнопки уведомления (Android, Chrome на компьютере; iOS их не показывает). */
export function notificationActions(msg: PushMessage): { action: string; title: string }[] {
  switch (msg.kind) {
    case 'event':
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
