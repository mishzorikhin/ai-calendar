import { describe, expect, it } from 'vitest'
import { RESTAURANTS } from '../mocks/restaurants'
import { hoursLabel, isOpenAt, rankPlaces } from './restaurants'
import type { Restaurant } from './types'

const base = RESTAURANTS[0] as Restaurant
const place = (opensAt: number, closesAt: number, rating = 4.5): Restaurant => ({ ...base, opensAt, closesAt, rating })

describe('isOpenAt', () => {
  it('обычные часы', () => {
    const cafe = place(8 * 60, 22 * 60)
    expect(isOpenAt(cafe, 9 * 60)).toBe(true)
    expect(isOpenAt(cafe, 7 * 60)).toBe(false)
    expect(isOpenAt(cafe, 22 * 60)).toBe(false)
  })

  it('закрытие после полуночи', () => {
    const bar = place(12 * 60, 25 * 60)
    expect(isOpenAt(bar, 9 * 60)).toBe(false)
    expect(isOpenAt(bar, 23 * 60)).toBe(true)
    expect(isOpenAt(bar, 30)).toBe(true)
    expect(isOpenAt(bar, 2 * 60)).toBe(false)
    expect(hoursLabel(bar)).toBe('12:00–01:00')
  })
})

describe('rankPlaces', () => {
  it('сначала открытые, затем по рейтингу', () => {
    const closed = { ...place(12 * 60, 25 * 60, 5), id: 'closed' }
    const good = { ...place(8 * 60, 22 * 60, 4.8), id: 'good' }
    const ok = { ...place(8 * 60, 22 * 60, 4.1), id: 'ok' }
    expect(rankPlaces([ok, closed, good], 9 * 60).map((r) => r.id)).toEqual(['good', 'ok', 'closed'])
  })
})
