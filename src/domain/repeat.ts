import { addDays, fromISODate, toISODate } from '../lib/dates'
import type { Repeat } from './types'

/** Варианты повтора в шторке события. */
export const REPEAT_OPTIONS: readonly { id: Repeat; label: string }[] = [
  { id: 'daily', label: 'Каждый день' },
  { id: 'weekdays', label: 'По будням' },
  { id: 'weekly', label: 'Каждую неделю' },
  { id: 'monthly', label: 'Каждый месяц' },
  { id: 'yearly', label: 'Каждый год' },
]

const REPEATS: readonly Repeat[] = REPEAT_OPTIONS.map((o) => o.id)

export const isRepeat = (v: unknown): v is Repeat => REPEATS.some((r) => r === v)

export function repeatLabel(r: Repeat): string {
  return REPEAT_OPTIONS.find((o) => o.id === r)?.label ?? ''
}

type Series = { date: string; repeat: Repeat; repeatUntil?: string; exdates?: readonly string[] }

/**
 * Есть ли вхождение серии в день `day` (ГГГГ-ММ-ДД). Те же правила, что у сервера (repeat.go):
 * 31-е и 29 февраля — только там, где такой день есть.
 */
export function occursOn(s: Series, day: string): boolean {
  if (day < s.date || (s.repeatUntil && day > s.repeatUntil) || s.exdates?.includes(day)) return false
  const start = fromISODate(s.date)
  const d = fromISODate(day)
  switch (s.repeat) {
    case 'daily':
      return true
    case 'weekdays':
      return d.getDay() !== 0 && d.getDay() !== 6
    case 'weekly':
      return d.getDay() === start.getDay()
    case 'monthly':
      return d.getDate() === start.getDate()
    case 'yearly':
      return d.getDate() === start.getDate() && d.getMonth() === start.getMonth()
  }
}

/** Новая дата начала серии, если вхождение `occurrence` перенесли на `date`: серия сдвигается целиком. */
export function shiftSeries(seriesStart: string, occurrence: Date, date: Date): string {
  const days = Math.round((date.getTime() - occurrence.getTime()) / 86_400_000)
  return toISODate(addDays(fromISODate(seriesStart), days))
}
