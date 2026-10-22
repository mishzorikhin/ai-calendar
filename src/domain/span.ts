import type { CalendarEvent } from './types'

const DAY = 24 * 60

/**
 * День day (ГГГГ-ММ-ДД) многодневного события, начатого date и законченного endDate, — как expandSpan
 * на сервере: первый день — с начала до полуночи, последний — с полуночи до конца, средние (и все дни
 * события на весь день) — на весь день. null — событие в этот день не идёт.
 */
export function spanDay<E extends CalendarEvent>(e: E, date: string, day: string): E | null {
  if (!e.endDate || day < date || day > e.endDate) return null
  const span = { date, start: e.start, end: e.end, allDay: e.allDay }
  const highlight = e.highlight && day === date
  if (e.allDay) return { ...e, span, highlight }
  if (day === date) return { ...e, span, highlight, end: DAY }
  if (day === e.endDate) return { ...e, span, highlight, start: 0 }
  return { ...e, span, highlight, start: 0, end: DAY, allDay: true }
}

/** Исходное событие по его дню: шторка правит запись целиком, а не отрезок дня. */
export function spanOrigin<E extends CalendarEvent & { date: Date }>(e: E, fromISO: (iso: string) => Date): E {
  if (!e.span) return e
  const { span, ...rest } = e
  return { ...rest, date: fromISO(span.date), start: span.start, end: span.end, allDay: span.allDay || undefined } as E
}
