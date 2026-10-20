import type { Badge, Booking, CalendarEvent, DatedEvent, MonthDots } from '../domain/types'
import { dayKey } from '../lib/dates'

const BASE_EVENTS: readonly CalendarEvent[] = [
  {
    id: 'sleep',
    title: 'Сон',
    subtitle: '4 ч глубокого',
    start: 6 * 60,
    end: 8 * 60,
    badge: 'sleep',
    sleepGraph: true,
  },
  { id: 'routine', title: 'Утренняя рутина', start: 8 * 60, end: 9 * 60, badge: 'routine' },
  {
    id: 'vc',
    title: 'Подготовка к созвону',
    subtitle: 'A301 — переговорная',
    start: 10 * 60 + 30,
    end: 11 * 60 + 30,
    badge: 'work',
  },
  { id: 'lunch', title: 'Обед с командой', subtitle: 'Water Bar', start: 13 * 60, end: 14 * 60, badge: 'food' },
  {
    id: 'ux',
    title: 'Встреча по UX',
    subtitle: 'Продуктовая команда',
    start: 15 * 60,
    end: 16 * 60 + 30,
    badge: 'work',
  },
  { id: 'gym', title: 'Тренировка', subtitle: 'Зал на Покровке', start: 17 * 60, end: 18 * 60, badge: 'sport' },
  { id: 'dinner', title: 'Ужин', subtitle: 'Дома', start: 19 * 60 + 30, end: 20 * 60 + 30, badge: 'food' },
  { id: 'read', title: 'Чтение', subtitle: '30 страниц', start: 22 * 60, end: 23 * 60, badge: 'read' },
]

/** Событие календаря для подтверждённой брони. */
export function bookingEvent(b: Booking): CalendarEvent {
  return {
    id: `booking-${b.id}`,
    title: `Завтрак · ${b.restaurant.name}`,
    subtitle: `${b.restaurant.address} · бронь ${b.code}`,
    start: b.slot.start,
    end: b.slot.end,
    badge: 'food',
    highlight: true,
  }
}

/**
 * Моковый «источник» календаря: базовое расписание, брони ассистента и события пользователя.
 * Дни немного различаются, чтобы смена дня в ленте недели была заметна.
 * Так же события собирает сервер (server/internal/api).
 */
export function eventsFor(
  date: Date,
  bookings: readonly Booking[] = [],
  custom: readonly DatedEvent[] = [],
): CalendarEvent[] {
  const seed = date.getDate() % 3
  const list = BASE_EVENTS.filter((e) => !(seed === 1 && e.id === 'gym') && !(seed === 2 && e.id === 'lunch'))
  for (const b of bookings) if (b.status === 'confirmed' && dayKey(b.date) === dayKey(date)) list.push(bookingEvent(b))
  for (const e of custom) if (dayKey(e.date) === dayKey(date)) list.push(e)
  return list.sort((a, b) => a.start - b.start)
}

const MONTH_DOTS: Readonly<Record<number, readonly Badge[]>> = {
  1: ['food'],
  3: ['work'],
  8: ['work', 'food'],
  11: ['work'],
  14: ['sport'],
  17: ['work', 'routine'],
  19: ['food'],
  22: ['sport', 'food'],
  25: ['work'],
  27: ['work', 'routine'],
  30: ['food'],
}

/** Значки событий по дням месяца (месяц с 0, как в Date). */
export function monthDotsFor(
  year: number,
  month: number,
  bookings: readonly Booking[] = [],
  custom: readonly DatedEvent[] = [],
): MonthDots {
  const days = new Date(year, month + 1, 0).getDate()
  const dots: Record<number, Badge[]> = {}
  for (const [day, badges] of Object.entries(MONTH_DOTS)) if (Number(day) <= days) dots[Number(day)] = [...badges]
  const add = (d: Date, badge: Badge) => {
    if (d.getFullYear() === year && d.getMonth() === month) (dots[d.getDate()] ??= []).push(badge)
  }
  for (const e of custom) add(e.date, e.badge)
  for (const b of bookings) if (b.status === 'confirmed') add(b.date, 'food')
  return dots
}
