import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE } from './profile'
import { focusMinutes, weekInsights } from './insights'
import type { CalendarEvent } from './types'

const ev = (date: string, start: number, end: number, badge: CalendarEvent['badge'], allDay = false) => ({
  id: `${date}-${start}`,
  title: 'x',
  date,
  start,
  end,
  badge,
  allDay,
})

// Тот же случай, что в Go (TestWeekInsights).
describe('weekInsights', () => {
  it('часы по типам и дням, среднее, фокус и закрытые задачи', () => {
    const events = [
      ev('2026-10-19', 600, 720, 'work'),
      ev('2026-10-19', 780, 840, 'work'),
      ev('2026-10-21', 540, 600, 'sport'),
      ev('2026-10-24', 600, 720, 'food'),
      ev('2026-10-22', 0, 1440, 'routine', true),
      ev('2026-10-12', 540, 780, 'work'),
      ev('2026-09-21', 540, 780, 'work'),
      ev('2026-09-01', 0, 600, 'work'),
    ]
    const local = (y: number, m: number, d: number, h: number) => new Date(y, m, d, h).toISOString()
    const tasks = [
      { id: 'a', title: 'a', kind: 'task' as const, done: true, doneAt: local(2026, 9, 21, 0) },
      { id: 'b', title: 'b', kind: 'task' as const, done: true, doneAt: local(2026, 9, 19, 1) },
      { id: 'c', title: 'c', kind: 'task' as const, done: true, doneAt: local(2026, 9, 18, 23) },
      { id: 'd', title: 'd', kind: 'task' as const, done: false },
      {
        id: 'e',
        title: 'e',
        kind: 'task' as const,
        done: true,
        role: 'member' as const,
        doneAt: local(2026, 9, 20, 9),
      },
    ]
    const r = weekInsights(new Date(2026, 9, 22), events, tasks, DEFAULT_PROFILE)
    expect(r).toMatchObject({ start: '2026-10-19', minutes: 360, average: 120, done: 2, busiest: '2026-10-19' })
    expect(r.byBadge).toEqual({ work: 180, sport: 60, food: 120 })
    expect(r.days[0]).toEqual({ date: '2026-10-19', minutes: 180, events: 2 })
    expect(r.focus).toBe(240 + 540 * 3 + 480)
  })

  it('фокус: выходной — ноль, «святой» блок занимает время', () => {
    expect(focusMinutes(DEFAULT_PROFILE, 6, [])).toBe(0)
    const lunch = { ...DEFAULT_PROFILE, protected: [{ title: 'Обед', start: 780, end: 840 }] }
    expect(focusMinutes(lunch, 1, [])).toBe(240 + 240)
  })
})
