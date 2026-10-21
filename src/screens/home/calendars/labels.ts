import type { IntegrationKind } from '../../../domain/types'
import { plural } from '../../../lib/plural'

/** Подпись вида календаря в списке. */
export const KIND_LABEL: Record<IntegrationKind, string> = {
  google: 'Google',
  outlook: 'Outlook',
  caldav: 'CalDAV',
  ics: 'Подписка',
}

/** «обновлено только что», «5 минут назад», «вчера в 18:20». */
export function syncedLabel(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return 'ещё не обновлялся'
  const at = new Date(iso)
  const diff = Math.max(0, now.getTime() - at.getTime())
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'обновлено только что'
  if (minutes < 60) return `обновлено ${minutes} ${plural(minutes, ['минуту', 'минуты', 'минут'])} назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `обновлено ${hours} ${plural(hours, ['час', 'часа', 'часов'])} назад`
  const time = at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  const days = Math.floor(hours / 24)
  if (days < 2) return `обновлено вчера в ${time}`
  return `обновлено ${at.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`
}

/** Готовые CalDAV-серверы: адрес и где взять пароль приложения. */
export const CALDAV_PRESETS = [
  {
    id: 'yandex',
    label: 'Яндекс',
    url: 'https://caldav.yandex.ru',
    login: 'Логин или почта Яндекса',
    hint: 'Нужен пароль приложения: Яндекс ID → Безопасность → Пароли приложений → «Календарь CalDAV».',
  },
  {
    id: 'icloud',
    label: 'iCloud',
    url: 'https://caldav.icloud.com',
    login: 'Apple ID',
    hint: 'Нужен пароль приложения: account.apple.com → Вход и безопасность → Пароли приложений.',
  },
  {
    id: 'nextcloud',
    label: 'Nextcloud',
    url: '',
    login: 'Логин Nextcloud',
    hint: 'Адрес — https://ваше-облако/remote.php/dav. Пароль приложения: Настройки → Безопасность.',
  },
  {
    id: 'other',
    label: 'Другой',
    url: '',
    login: 'Логин',
    hint: 'Подойдёт любой сервер CalDAV: Fastmail, Mail.ru, Radicale, Baïkal. Достаточно адреса сервера.',
  },
] as const

export type CalDavPresetId = (typeof CALDAV_PRESETS)[number]['id']
