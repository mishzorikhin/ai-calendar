import { describe, expect, it } from 'vitest'
import { restoreEvent, restoreTask } from './undo'

describe('восстановление после удаления', () => {
  it('событие — со всеми полями, серия — с убранными днями', () => {
    const { input, skips } = restoreEvent({
      id: 'evt-1',
      title: 'Йога',
      date: new Date(2026, 9, 28),
      seriesDate: '2026-10-21',
      start: 540,
      end: 600,
      badge: 'sport',
      reminders: [],
      repeat: 'weekly',
      exdates: ['2026-10-28'],
      notes: 'коврик',
      attendees: [{ username: 'bob', name: 'Bob', status: 'accepted' }],
    })
    expect(input).toMatchObject({ title: 'Йога', repeat: 'weekly', reminders: [], notes: 'коврик', attendees: ['bob'] })
    expect(input.subtitle).toBeUndefined()
    expect(skips).toEqual(['2026-10-28'])
    // Удалили во вхождении 28-го — серия вернётся с первого дня, 21-го.
    expect(input.date.getDate()).toBe(21)
  })

  it('напоминание по умолчанию (null) не превращается в «не напоминать»', () => {
    const { input } = restoreEvent({
      id: 'e',
      title: 'x',
      date: new Date(),
      start: 0,
      end: 60,
      badge: 'work',
      reminders: null,
    })
    expect('reminders' in input).toBe(false)
  })

  it('задача — с участниками и отметкой', () => {
    const r = restoreTask({
      id: 't',
      title: 'Отчёт',
      kind: 'goal',
      done: true,
      due: '2026-11-01',
      members: [{ id: 2, username: 'anna', name: 'Anna' }],
    })
    expect(r).toEqual({ input: { title: 'Отчёт', kind: 'goal', due: '2026-11-01', members: ['anna'] }, done: true })
  })
})
