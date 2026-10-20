import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, MAX_GUESTS, clampGuests, dayLabel, guestsLabel, paramsDate } from './request'

describe('request', () => {
  it('guestsLabel склоняет', () => {
    expect(guestsLabel(1)).toBe('1 гость')
    expect(guestsLabel(2)).toBe('2 гостя')
    expect(guestsLabel(5)).toBe('5 гостей')
    expect(guestsLabel(21)).toBe('21 гость')
  })

  it('clampGuests держит границы', () => {
    expect(clampGuests(0)).toBe(1)
    expect(clampGuests(MAX_GUESTS + 3)).toBe(MAX_GUESTS)
  })

  it('дата и подпись дня', () => {
    expect(dayLabel(2)).toBe('Послезавтра')
    expect(paramsDate(DEFAULT_PARAMS, new Date(2026, 9, 20, 18))).toEqual(new Date(2026, 9, 21))
  })
})
