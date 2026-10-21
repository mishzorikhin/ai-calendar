/** Ограничения входных данных. Те же значения — в server/internal/api/api.go. */
export const LIMITS = {
  title: 120,
  subtitle: 200,
  message: 2000,
  dayMinutes: 24 * 60,
  /** Напоминаний у события и самое раннее из них — за неделю. */
  reminders: 3,
  reminderMinutes: 7 * 24 * 60,
} as const

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
