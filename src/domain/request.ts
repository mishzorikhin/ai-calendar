import { addDays, startOfDay } from '../lib/dates'
import { plural } from '../lib/plural'
import type { RequestParams } from './types'

export const MIN_GUESTS = 1
export const MAX_GUESTS = 8

export const DEFAULT_PARAMS: RequestParams = { dayOffset: 1, guests: 2, radiusKm: 1, invite: true }

export const DAY_OPTIONS = [
  { value: 0, label: 'Сегодня' },
  { value: 1, label: 'Завтра' },
  { value: 2, label: 'Послезавтра' },
] as const

export const RADIUS_OPTIONS = [1, 3, 5] as const

export function dayLabel(offset: number): string {
  return DAY_OPTIONS.find((d) => d.value === offset)?.label ?? 'Завтра'
}

export function guestsLabel(n: number): string {
  return `${n} ${plural(n, ['гость', 'гостя', 'гостей'])}`
}

export function clampGuests(n: number): number {
  return Math.min(MAX_GUESTS, Math.max(MIN_GUESTS, n))
}

export function paramsDate(params: RequestParams, today: Date = new Date()): Date {
  return addDays(startOfDay(today), params.dayOffset)
}
