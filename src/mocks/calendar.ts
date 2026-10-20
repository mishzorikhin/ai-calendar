import type { CalendarEvent, DatedEvent, MonthDots } from '../domain/types'
import { dayKey } from '../lib/dates'

/**
 * Локальный режим показывает только события пользователя —
 * как и сервер без демо-расписания.
 */
export function eventsFor(date: Date, custom: readonly DatedEvent[] = []): CalendarEvent[] {
  return custom.filter((e) => dayKey(e.date) === dayKey(date)).sort((a, b) => a.start - b.start)
}

/** Значки событий по дням месяца (месяц с 0, как в Date). */
export function monthDotsFor(year: number, month: number, custom: readonly DatedEvent[] = []): MonthDots {
  const dots: Record<number, CalendarEvent['badge'][]> = {}
  for (const e of custom) {
    if (e.date.getFullYear() === year && e.date.getMonth() === month) {
      ;(dots[e.date.getDate()] ??= []).push(e.badge)
    }
  }
  return dots
}
