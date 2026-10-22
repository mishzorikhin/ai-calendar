/** Ограничения входных данных. Те же значения — в server/internal/api/api.go. */
export const LIMITS = {
  title: 120,
  subtitle: 200,
  message: 2000,
  dayMinutes: 24 * 60,
  /** Напоминаний у события и самое раннее из них — за неделю. */
  reminders: 3,
  reminderMinutes: 7 * 24 * 60,
  notes: 2000,
  url: 500,
  travel: 240,
  /** Самое длинное многодневное событие, дней. */
  spanDays: 60,
  /** Оценка задачи, минут. */
  estimateMin: 15,
  estimateMax: 480,
} as const

/** Оценка задачи: нет, 0 (снять) или от 15 минут до 8 часов — как на сервере. */
export function estimateError(estimate: number | undefined): string | null {
  if (estimate === undefined || estimate === 0) return null
  return Number.isInteger(estimate) && estimate >= LIMITS.estimateMin && estimate <= LIMITS.estimateMax
    ? null
    : 'Оценка — от 15 минут до 8 часов'
}

/** Длина в символах Unicode (как на сервере), а не в UTF-16-единицах. */
const length = (s: string) => [...s].length

/** Время задано верно: минуты от полуночи, конец позже начала и не позже конца суток. */
export const isValidRange = (start: number, end: number) =>
  Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= LIMITS.dayMinutes && end > start

/** Текст ошибки для названия или null, если всё в порядке. */
export const titleError = (title: string) =>
  title && length(title) <= LIMITS.title ? null : `Название обязательно и не длиннее ${LIMITS.title} символов`

export const subtitleError = (subtitle: string | undefined) =>
  subtitle && length(subtitle) > LIMITS.subtitle ? `Подзаголовок не длиннее ${LIMITS.subtitle} символов` : null

export const messageError = (text: string) =>
  text && length(text) <= LIMITS.message ? null : `Текст обязателен и не длиннее ${LIMITS.message} символов`

/** Напоминания события: целые минуты до начала, без повторов, раньше — первее (как на сервере). */
export function normalizeReminders(list: readonly number[]): number[] {
  return [...new Set(list)].sort((a, b) => b - a)
}

export const remindersError = (list: readonly number[] | null | undefined) => {
  if (!list) return null
  if (normalizeReminders(list).length > LIMITS.reminders) return `Не больше ${LIMITS.reminders} напоминаний у события`
  return list.every((m) => Number.isInteger(m) && m >= 0 && m <= LIMITS.reminderMinutes)
    ? null
    : `Напоминание — от 0 до ${LIMITS.reminderMinutes} минут до начала`
}

/** Заметки, ссылка и дорога — те же правила, что validateDetails на сервере. */
export function detailsError(d: { notes?: string; url?: string; travel?: number }): string | null {
  if (d.notes && length(d.notes) > LIMITS.notes) return `Заметки — не длиннее ${LIMITS.notes} символов`
  if (d.url) {
    let ok = false
    try {
      const u = new URL(d.url)
      ok = (u.protocol === 'https:' || u.protocol === 'http:') && u.host !== '' && d.url.length <= LIMITS.url
    } catch {
      ok = false
    }
    if (!ok) return `Ссылка — адрес http(s):// не длиннее ${LIMITS.url} символов`
  }
  const t = d.travel ?? 0
  if (!Number.isInteger(t) || t < 0 || t > LIMITS.travel) return `Дорога — от 0 до ${LIMITS.travel} минут`
  return null
}

/** Многодневное событие — как validateEventShape на сервере; без endDate — обычный интервал. */
export function spanError(e: {
  date: string
  endDate?: string
  start: number
  end: number
  repeat?: string
}): string | null {
  if (!e.endDate) return isValidRange(e.start, e.end) ? null : 'Время задано неверно'
  if (e.endDate <= e.date) return 'Последний день должен быть позже первого'
  const days = (Date.parse(e.endDate) - Date.parse(e.date)) / 86_400_000
  if (days > LIMITS.spanDays) return `Многодневное событие — не длиннее ${LIMITS.spanDays} дней`
  if (e.repeat) return 'Многодневное событие не повторяется'
  const ok =
    Number.isInteger(e.start) && Number.isInteger(e.end) && e.start >= 0 && e.start < LIMITS.dayMinutes && e.end > 0
  return ok && e.end <= LIMITS.dayMinutes ? null : 'Время задано неверно'
}
