import { describe, expect, it } from 'vitest'
import { checkedNow, habitStreak, weekDots } from './habit'

// 2026-10-22 — четверг. Те же случаи, что в Go (TestHabitStreak).
describe('habitStreak', () => {
  it.each([
    ['сегодня и два дня до', 'daily', ['2026-10-20', '2026-10-21', '2026-10-22'], 3],
    ['сегодня ещё не отмечено', 'daily', ['2026-10-20', '2026-10-21'], 2],
    ['пропуск обрывает', 'daily', ['2026-10-19', '2026-10-21', '2026-10-22'], 2],
    ['позавчера — уже ноль', 'daily', ['2026-10-20'], 0],
    ['будни через выходные', 'weekdays', ['2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21'], 4],
    ['недели', 'weekly', ['2026-10-05', '2026-10-15', '2026-10-21'], 3],
    ['эта неделя ещё не отмечена', 'weekly', ['2026-10-08', '2026-10-13'], 2],
    ['пусто', 'daily', [], 0],
  ] as const)('%s', (_name, cadence, checks, want) => {
    expect(habitStreak(cadence, checks, '2026-10-22')).toBe(want)
  })

  it('в выходной серия по будням считается с пятницы', () => {
    expect(habitStreak('weekdays', ['2026-10-22', '2026-10-23'], '2026-10-25')).toBe(2)
  })

  it('отметка периода и точки недели', () => {
    expect(checkedNow('daily', ['2026-10-22'], '2026-10-22')).toBe(true)
    expect(checkedNow('weekly', ['2026-10-19'], '2026-10-22')).toBe(true)
    expect(checkedNow('weekly', ['2026-10-18'], '2026-10-22')).toBe(false)
    const dots = weekDots(['2026-10-19', '2026-10-22', '2026-10-30'], '2026-10-22')
    expect(dots.map((d) => d.date)[0]).toBe('2026-10-19')
    expect(dots.map((d) => d.done)).toEqual([true, false, false, true, false, false, false])
  })
})
