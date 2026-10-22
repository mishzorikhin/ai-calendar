import { describe, expect, it } from 'vitest'
import { detailsError, spanError } from './limits'
import { spanDay, spanOrigin } from './span'
import type { CalendarEvent } from './types'

const conf: CalendarEvent = {
  id: 'e',
  title: 'Конференция',
  start: 600,
  end: 1080,
  badge: 'work',
  endDate: '2026-10-23',
}

describe('многодневные события', () => {
  it('режет по дням, как сервер', () => {
    expect(spanDay(conf, '2026-10-21', '2026-10-20')).toBeNull()
    expect(spanDay(conf, '2026-10-21', '2026-10-21')).toMatchObject({ start: 600, end: 1440 })
    expect(spanDay(conf, '2026-10-21', '2026-10-22')).toMatchObject({ start: 0, end: 1440, allDay: true })
    expect(spanDay(conf, '2026-10-21', '2026-10-23')).toMatchObject({ start: 0, end: 1080 })
    expect(spanDay(conf, '2026-10-21', '2026-10-24')).toBeNull()
    expect(spanDay(conf, '2026-10-21', '2026-10-22')?.span).toEqual({
      date: '2026-10-21',
      start: 600,
      end: 1080,
      allDay: undefined,
    })
  })

  it('восстанавливает исходное событие по любому дню', () => {
    const mid = { ...spanDay(conf, '2026-10-21', '2026-10-22')!, date: new Date(2026, 9, 22) }
    const origin = spanOrigin(mid, (iso) => new Date(iso + 'T00:00'))
    expect(origin.start).toBe(600)
    expect(origin.end).toBe(1080)
    expect(origin.allDay).toBeUndefined()
    expect(origin.date.getDate()).toBe(21)
    expect(origin.span).toBeUndefined()
  })

  it('проверки как на сервере', () => {
    const base = { date: '2026-10-21', start: 600, end: 660 }
    expect(spanError(base)).toBeNull()
    expect(spanError({ ...base, endDate: '2026-10-21' })).not.toBeNull()
    expect(spanError({ ...base, endDate: '2027-01-21' })).not.toBeNull()
    expect(spanError({ ...base, endDate: '2026-10-22', repeat: 'weekly' })).not.toBeNull()
    expect(spanError({ ...base, endDate: '2026-10-22', end: 300 })).toBeNull()
    expect(detailsError({ url: 'javascript:alert(1)' })).not.toBeNull()
    expect(detailsError({ url: 'https://meet.google.com/x', travel: 30 })).toBeNull()
    expect(detailsError({ travel: 300 })).not.toBeNull()
  })
})
