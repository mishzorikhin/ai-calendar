import { describe, expect, it } from 'vitest'
import { formatMinutes, formatTimer, monthGrid, relativeDayLabel, startOfWeek, weekdayIndex } from './dates'

describe('dates', () => {
  it('formatMinutes', () => {
    expect(formatMinutes(9 * 60)).toBe('09:00')
    expect(formatMinutes(10 * 60 + 30)).toBe('10:30')
    expect(formatMinutes(25 * 60)).toBe('01:00')
  })

  it('formatTimer', () => {
    expect(formatTimer(7)).toBe('00:07')
    expect(formatTimer(75)).toBe('01:15')
  })

  it('неделя начинается с понедельника', () => {
    const sunday = new Date(2026, 9, 25)
    expect(weekdayIndex(sunday)).toBe(6)
    expect(startOfWeek(sunday)).toEqual(new Date(2026, 9, 19))
  })

  it('monthGrid: пустые клетки до первого числа и все дни месяца', () => {
    // 1 октября 2026 — четверг: три пустые клетки (пн, вт, ср).
    const cells = monthGrid(2026, 9)
    expect(cells.slice(0, 3)).toEqual([null, null, null])
    expect(cells[3]).toEqual(new Date(2026, 9, 1))
    expect(cells.filter(Boolean)).toHaveLength(31)
  })

  it('relativeDayLabel', () => {
    const today = new Date(2026, 9, 20, 15, 0)
    expect(relativeDayLabel(new Date(2026, 9, 20), today)).toBe('Сегодня')
    expect(relativeDayLabel(new Date(2026, 9, 21), today)).toBe('Завтра')
    expect(relativeDayLabel(new Date(2026, 9, 22), today)).toBe('Послезавтра')
    expect(relativeDayLabel(new Date(2026, 9, 23), today)).toBe('Пт, 23 октября')
  })
})
