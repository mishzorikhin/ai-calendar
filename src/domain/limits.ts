/** Ограничения входных данных. Те же значения — в server/internal/api/api.go. */
export const LIMITS = {
  title: 120,
  subtitle: 200,
  message: 2000,
  minGuests: 1,
  maxGuests: 8,
  dayMinutes: 24 * 60,
} as const

/** Время задано верно: минуты от полуночи, конец позже начала и не позже конца суток. */
export const isValidRange = (start: number, end: number) =>
  Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= LIMITS.dayMinutes && end > start
