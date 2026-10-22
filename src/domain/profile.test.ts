import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROFILE,
  applyProfilePatch,
  daysLabel,
  isMemoryDate,
  memoryDateLabel,
  normalizePerson,
  personError,
  profileError,
} from './profile'

describe('daysLabel', () => {
  it('склеивает подряд идущие дни, как сервер', () => {
    expect(daysLabel([1, 2, 3, 4, 5])).toBe('пн–пт')
    expect(daysLabel([1, 3, 5])).toBe('пн, ср, пт')
    expect(daysLabel([0, 6])).toBe('сб, вс')
    expect(daysLabel([1, 2, 4, 5, 6])).toBe('пн, вт, чт–сб')
    expect(daysLabel([])).toBe('каждый день')
    expect(daysLabel(undefined)).toBe('каждый день')
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('каждый день')
  })
})

describe('profileError', () => {
  it('профиль по умолчанию верен', () => {
    expect(profileError(DEFAULT_PROFILE)).toBeNull()
  })

  it('ловит те же ошибки, что сервер', () => {
    const bad: Partial<typeof DEFAULT_PROFILE>[] = [
      { workStart: 1200 },
      { workDays: [7] },
      { meetingMinutes: 5 },
      { bufferMinutes: 90 },
      { protected: [{ title: '', start: 600, end: 660 }] },
      { protected: [{ title: 'Спорт', start: 700, end: 600 }] },
      { proactive: 9 },
      { about: 'я'.repeat(501) },
      { wakeUp: 1500 },
    ]
    for (const patch of bad) expect(profileError({ ...DEFAULT_PROFILE, ...patch })).not.toBeNull()
  })

  it('патч упорядочивает дни и чистит текст', () => {
    const p = applyProfilePatch(DEFAULT_PROFILE, {
      workDays: [5, 1, 1, 3],
      protected: [{ title: ' Обед ', start: 780, end: 840, days: [2, 1] }],
      about: '  ',
    })
    expect(p.workDays).toEqual([1, 3, 5])
    expect(p.protected[0]).toEqual({ title: 'Обед', start: 780, end: 840, days: [1, 2] })
    expect(p.about).toBeUndefined()
  })
})

describe('даты памяти и карточки людей', () => {
  it('принимает полную и ежегодную дату', () => {
    expect(isMemoryDate('--03-14')).toBe(true)
    expect(isMemoryDate('--02-29')).toBe(true)
    expect(isMemoryDate('1990-03-14')).toBe(true)
    expect(isMemoryDate('--13-01')).toBe(false)
    expect(isMemoryDate('14 марта')).toBe(false)
    expect(isMemoryDate('2026-02-30')).toBe(false)
    expect(memoryDateLabel('--03-14')).toBe('14 марта')
    expect(memoryDateLabel('1990-12-01')).toBe('1 декабря 1990')
  })

  it('проверяет и нормализует карточку', () => {
    expect(personError({ name: '' })).not.toBeNull()
    expect(personError({ name: 'x', meetingMinutes: 5 })).not.toBeNull()
    expect(personError({ name: 'x', username: 'ы' })).not.toBeNull()
    expect(personError({ name: 'Глеб', birthday: '--03-14', username: '@Gleb' })).toBeNull()
    expect(normalizePerson({ name: ' Глеб ', aliases: ['Г', 'Г', ' '], username: '@Gleb', relation: ' ' })).toEqual({
      name: 'Глеб',
      aliases: ['Г'],
      relation: undefined,
      place: undefined,
      meetingMinutes: undefined,
      birthday: undefined,
      notes: undefined,
      username: 'gleb',
    })
  })
})
