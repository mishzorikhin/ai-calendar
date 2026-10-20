/** Ограничения входных данных. Те же значения — в server/internal/api/api.go. */
export const LIMITS = {
  title: 120,
  subtitle: 200,
  message: 2000,
  dayMinutes: 24 * 60,
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
