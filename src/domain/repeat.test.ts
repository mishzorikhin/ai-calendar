import { describe, expect, it } from 'vitest'
import { isRepeat, occursOn, repeatLabel, shiftSeries } from './repeat'

describe('повторы — как на сервере', () => {
  const tuesday = { date: '2026-10-20', repeat: 'weekly' as const }

  it('каждую неделю, по будням, каждый день', () => {
    expect(occursOn(tuesday, '2026-10-27')).toBe(true)
    expect(occursOn(tuesday, '2026-10-28')).toBe(false)
    expect(occursOn(tuesday, '2026-10-13')).toBe(false) // до начала серии
    const weekdays = { date: '2026-10-20', repeat: 'weekdays' as const }
    expect(['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'].map((d) => occursOn(weekdays, d))).toEqual([
      true,
      false,
      false,
      true,
    ])
    expect(occursOn({ date: '2026-10-20', repeat: 'daily' }, '2027-03-01')).toBe(true)
  })

  it('месяц и год: только существующие дни', () => {
    const d31 = { date: '2026-01-31', repeat: 'monthly' as const }
    expect(occursOn(d31, '2026-02-28')).toBe(false)
    expect(occursOn(d31, '2026-03-31')).toBe(true)
    const leap = { date: '2024-02-29', repeat: 'yearly' as const }
    expect(occursOn(leap, '2025-02-28')).toBe(false)
    expect(occursOn(leap, '2028-02-29')).toBe(true)
  })

  it('конец серии и убранные дни', () => {
    const s = { ...tuesday, repeatUntil: '2026-11-03', exdates: ['2026-10-27'] }
    expect(occursOn(s, '2026-10-27')).toBe(false)
    expect(occursOn(s, '2026-11-03')).toBe(true)
    expect(occursOn(s, '2026-11-10')).toBe(false)
  })

  it('перенос вхождения сдвигает серию', () => {
    expect(shiftSeries('2026-10-20', new Date(2026, 10, 10), new Date(2026, 10, 11))).toBe('2026-10-21')
    expect(shiftSeries('2026-10-20', new Date(2026, 10, 10), new Date(2026, 10, 10))).toBe('2026-10-20')
  })

  it('подписи и проверка', () => {
    expect(repeatLabel('weekdays')).toBe('По будням')
    expect(isRepeat('monthly')).toBe(true)
    expect(isRepeat('hourly')).toBe(false)
  })
})
