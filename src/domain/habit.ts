import { addDays, fromISODate, startOfWeek, toISODate } from '../lib/dates'
import type { Cadence } from './types'

const shift = (date: string, n: number) => toISODate(addDays(fromISODate(date), n))
const weekend = (date: string) => {
  const d = fromISODate(date).getDay()
  return d === 0 || d === 6
}
const mondayOf = (date: string) => toISODate(startOfWeek(fromISODate(date)))

/**
 * Сколько периодов подряд привычка выполнена, считая назад от today. Текущий период может быть
 * ещё не отмечен — тогда серия считается с прошлого. daily — дни, weekdays — будни (выходные не
 * прерывают), weekly — недели с понедельника. Та же функция на сервере — habitStreak в habits.go.
 */
export function habitStreak(cadence: Cadence, checks: readonly string[], today: string): number {
  if (cadence === 'weekly') {
    const weeks = new Set(checks.map(mondayOf))
    let week = mondayOf(today)
    if (!weeks.has(week)) week = shift(week, -7)
    let n = 0
    for (; weeks.has(week); week = shift(week, -7)) n++
    return n
  }
  const done = new Set(checks)
  const skip = (d: string) => cadence === 'weekdays' && weekend(d)
  const back = (d: string) => {
    let x = shift(d, -1)
    while (skip(x)) x = shift(x, -1)
    return x
  }
  let day = today
  while (skip(day)) day = shift(day, -1)
  if (!done.has(day)) day = back(day)
  let n = 0
  for (; done.has(day); day = back(day)) n++
  return n
}

/** Отмечена ли привычка в текущем периоде (сегодня или на этой неделе для weekly). */
export function checkedNow(cadence: Cadence, checks: readonly string[], today: string): boolean {
  if (cadence !== 'weekly') return checks.includes(today)
  const week = mondayOf(today)
  return checks.some((d) => mondayOf(d) === week)
}

/** Точки недели с понедельника: дата и отметка (для карточки привычки). */
export function weekDots(checks: readonly string[], today: string): { date: string; done: boolean }[] {
  const monday = mondayOf(today)
  const done = new Set(checks)
  return Array.from({ length: 7 }, (_, i) => {
    const date = shift(monday, i)
    return { date, done: done.has(date) }
  })
}

/** Подпись серии: «3 дня подряд», «2 недели подряд». */
export function streakUnit(cadence: Cadence): readonly [string, string, string] {
  return cadence === 'weekly' ? ['неделя', 'недели', 'недель'] : ['день', 'дня', 'дней']
}

export const CADENCES: readonly { id: Cadence; label: string }[] = [
  { id: 'daily', label: 'Каждый день' },
  { id: 'weekdays', label: 'По будням' },
  { id: 'weekly', label: 'Раз в неделю' },
]

/** Не больше стольких отметок у привычки (старые отбрасываются) — как на сервере. */
export const MAX_HABIT_CHECKS = 400

/** Отметки после «сделано» (on) или «снять» за день date: по порядку, без повторов. */
export function withCheck(checks: readonly string[], date: string, on: boolean): string[] {
  const out = checks.filter((d) => d !== date)
  if (on) {
    out.push(date)
    out.sort()
  }
  return out.slice(-MAX_HABIT_CHECKS)
}
