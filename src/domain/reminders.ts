import { pluralize } from '../lib/plural'
import type { NotifySettings } from './types'

/** Настройки, пока пользователь их не менял (как DefaultNotifySettings на сервере). */
export const DEFAULT_NOTIFY_SETTINGS: NotifySettings = { eventReminder: 10, taskTime: 9 * 60, digest: -1 }

/** Готовые варианты напоминания о событии, минут до начала. */
export const REMINDER_PRESETS = [0, 5, 10, 15, 30, 60, 120, 1440] as const

/** Варианты времени для напоминаний о задачах и сводки, минуты от полуночи. */
export const DAY_TIME_PRESETS = [7 * 60, 8 * 60, 9 * 60, 10 * 60, 12 * 60, 18 * 60, 20 * 60, 21 * 60] as const

const MINUTE = ['минуту', 'минуты', 'минут'] as const
const HOUR = ['час', 'часа', 'часов'] as const
const DAY = ['день', 'дня', 'дней'] as const

/** «За 10 минут», «За 1 час», «В момент начала»; −1 — «Не напоминать». */
export function reminderLabel(minutes: number): string {
  if (minutes < 0) return 'Не напоминать'
  if (minutes === 0) return 'В момент начала'
  if (minutes % 1440 === 0) return minutes === 1440 ? 'За день' : `За ${pluralize(minutes / 1440, DAY)}`
  if (minutes % 60 === 0) return minutes === 60 ? 'За час' : `За ${pluralize(minutes / 60, HOUR)}`
  return `За ${pluralize(minutes, MINUTE)}`
}

/** Короткая подпись для кнопки-переключателя: «Нет», «В начале», «10 мин», «1 ч», «За день». */
export function reminderShortLabel(minutes: number): string {
  if (minutes < 0) return 'Нет'
  if (minutes === 0) return 'В начале'
  if (minutes === 1440) return 'За день'
  if (minutes % 1440 === 0) return `${minutes / 1440} дн`
  if (minutes % 60 === 0) return `${minutes / 60} ч`
  return `${minutes} мин`
}

/** «9:00»; −1 — «Выключено». */
export function dayTimeLabel(minutes: number): string {
  if (minutes < 0) return 'Выключено'
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}
