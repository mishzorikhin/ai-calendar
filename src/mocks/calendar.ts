import type { Badge, Booking, CalendarEvent, DatedEvent } from '../domain/types'
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

/**
 * Моковый «источник» календаря: базовое расписание, бронь ассистента и события пользователя.
 * Дни немного различаются, чтобы смена дня в ленте недели была заметна.
 */
export function eventsFor(date: Date, booking: Booking | null, custom: readonly DatedEvent[] = []): CalendarEvent[] {
  const seed = date.getDate() % 3
  const list = BASE_EVENTS.filter((e) => !(seed === 1 && e.id === 'gym') && !(seed === 2 && e.id === 'lunch'))
  if (booking && dayKey(booking.date) === dayKey(date)) {
    list.push({
      id: 'booked',
      title: `Завтрак · ${booking.restaurant.name}`,
      subtitle: `${booking.restaurant.address} · бронь ${booking.code}`,
      start: booking.slot.start,
      end: booking.slot.end,
      badge: 'food',
      highlight: true,
    })
  }
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

/** Цветные точки событий в месячной сетке. */
export function monthDots(date: Date): readonly Badge[] {
  return MONTH_DOTS[date.getDate()] ?? []
}
