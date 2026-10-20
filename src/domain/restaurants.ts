import { formatMinutes } from '../lib/dates'
import type { Restaurant } from './types'

/** Открыто ли место в указанное время (учитывает закрытие после полуночи). */
export function isOpenAt(r: Restaurant, mins: number): boolean {
  const t = mins < r.opensAt && r.closesAt > 24 * 60 ? mins + 24 * 60 : mins
  return t >= r.opensAt && t < r.closesAt
}

export function hoursLabel(r: Restaurant): string {
  return `${formatMinutes(r.opensAt)}–${formatMinutes(r.closesAt)}`
}

/** Сначала места, открытые в нужное время, затем по рейтингу. */
export function rankPlaces(list: readonly Restaurant[], mins: number): Restaurant[] {
  return [...list].sort((a, b) => Number(isOpenAt(b, mins)) - Number(isOpenAt(a, mins)) || b.rating - a.rating)
}
