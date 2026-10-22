import { addDays, fromISODate, startOfWeek, toISODate } from '../lib/dates'
import type { Badge, CalendarEvent, Profile, Task, WeekInsights } from './types'

/** Свободный отрезок в рабочие часы от стольких минут — время для сосредоточенной работы. */
export const FOCUS_BLOCK = 90

const shift = (date: string, n: number) => toISODate(addDays(fromISODate(date), n))

/** Свободные отрезки рабочего дня не короче FOCUS_BLOCK: с перерывами, дорогой и «святыми» блоками. */
export function focusMinutes(p: Profile, weekday: number, events: readonly CalendarEvent[]): number {
  if (!p.workDays.includes(weekday)) return 0
  const dayEnd = p.bedTime <= p.wakeUp ? 1440 : p.bedTime
  const from = Math.max(p.wakeUp, p.workStart)
  const to = Math.min(dayEnd, p.workEnd)
  const busy = [
    ...events
      .filter((e) => !e.allDay)
      .map((e) => [e.start - p.bufferMinutes - (e.travel ?? 0), e.end + p.bufferMinutes]),
    ...p.protected.filter((b) => !b.days?.length || b.days.includes(weekday)).map((b) => [b.start, b.end]),
  ].sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0))
  let cursor = from
  let total = 0
  const add = (end: number) => {
    const start = Math.ceil(cursor / 5) * 5
    if (end - start >= FOCUS_BLOCK) total += end - start
  }
  for (const [start = 0, end = 0] of busy) {
    if (end <= cursor) continue
    if (start >= to) break
    add(Math.min(start, to))
    cursor = Math.max(cursor, end)
  }
  if (cursor < to) add(to)
  return total
}

/**
 * Обзор недели с понедельника start: минуты встреч по типам и дням, среднее за четыре прошлые недели,
 * время для фокуса, закрытые задачи. events — с датой (ГГГГ-ММ-ДД) за start−28…start+6.
 * Те же правила, что weekInsights на сервере (insights.go).
 */
export function weekInsights(
  startDate: Date,
  events: readonly (CalendarEvent & { date: string })[],
  tasks: readonly Task[],
  p: Profile,
): WeekInsights {
  const start = toISODate(startOfWeek(startDate))
  const end = shift(start, 7)
  const pastFrom = shift(start, -28)
  const byBadge: Partial<Record<Badge, number>> = {}
  const byDay = new Map<string, CalendarEvent[]>()
  let minutes = 0
  let past = 0
  for (const e of events) {
    if (e.allDay || e.invite?.status === 'declined') continue
    const mins = e.end - e.start
    if (e.date >= start && e.date < end) {
      byDay.set(e.date, [...(byDay.get(e.date) ?? []), e])
      byBadge[e.badge] = (byBadge[e.badge] ?? 0) + mins
      minutes += mins
    } else if (e.date >= pastFrom && e.date < start) {
      past += mins
    }
  }
  let busiest: string | undefined
  let most = 0
  let focus = 0
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = shift(start, i)
    const list = byDay.get(date) ?? []
    const dayMinutes = list.reduce((sum, e) => sum + e.end - e.start, 0)
    if (dayMinutes > most) {
      most = dayMinutes
      busiest = date
    }
    focus += focusMinutes(p, fromISODate(date).getDay(), list)
    return { date, minutes: dayMinutes, events: list.length }
  })
  const done = tasks.filter((t) => {
    if (!t.doneAt) return false
    const day = toISODate(new Date(t.doneAt))
    return day >= start && day < end
  }).length
  return { start, days, byBadge, minutes, average: Math.floor(past / 4), focus, done, busiest }
}
