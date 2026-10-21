import { relativeDayLabel } from '../lib/dates'
import { pluralize } from '../lib/plural'
import type { NotifySettings } from './types'

/** Настройки, пока пользователь их не менял (как DefaultNotifySettings на сервере). */
export const DEFAULT_NOTIFY_SETTINGS: NotifySettings = {
  eventReminder: 10,
  taskTime: 9 * 60,
  digest: -1,
  evening: -1,
  quietFrom: -1,
  quietTo: -1,
}

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

/** Готовые тихие часы: [начало, конец] в минутах от полуночи. */
export const QUIET_PRESETS: readonly (readonly [number, number])[] = [
  [22 * 60, 7 * 60],
  [23 * 60, 7 * 60],
  [23 * 60, 8 * 60],
  [0, 8 * 60],
]

/** Тихие часы одним числом для выбора-«таблеток»: −1 — выключены. */
export function encodeQuiet(from: number, to: number): number {
  return from < 0 || to < 0 ? -1 : from * 1440 + to
}

export function decodeQuiet(code: number): { quietFrom: number; quietTo: number } {
  return code < 0 ? { quietFrom: -1, quietTo: -1 } : { quietFrom: Math.floor(code / 1440), quietTo: code % 1440 }
}

/** «23:00–7:00»; −1 — «Нет». */
export function quietLabel(code: number): string {
  if (code < 0) return 'Нет'
  const { quietFrom, quietTo } = decodeQuiet(code)
  return `${dayTimeLabel(quietFrom)}–${dayTimeLabel(quietTo)}`
}

/** Быстрые варианты времени для своего напоминания. Вечерний — пока до вечера больше часа. */
export function alarmPresets(now: Date): { label: string; at: Date }[] {
  const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000)
  const at = (days: number, hour: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour, 0, 0, 0)
  const out = [
    { label: 'Через 15 мин', at: later(15) },
    { label: 'Через 30 мин', at: later(30) },
    { label: 'Через час', at: later(60) },
    { label: 'Через 3 часа', at: later(180) },
  ]
  if (now.getHours() < 18) out.push({ label: 'Вечером в 19:00', at: at(0, 19) })
  out.push({ label: 'Завтра в 9:00', at: at(1, 9) })
  return out
}

/** «Сегодня в 18:00», «Завтра в 9:05», «Сб, 24 октября в 10:00». */
export function alarmWhenLabel(at: Date, now: Date): string {
  return `${relativeDayLabel(at, now)} в ${dayTimeLabel(at.getHours() * 60 + at.getMinutes())}`
}
