import { describe, expect, it } from 'vitest'
import { normalizeReminders, remindersError } from './limits'
import { dayTimeLabel, reminderLabel, reminderShortLabel } from './reminders'

describe('подписи напоминаний', () => {
  it('полные', () => {
    expect(reminderLabel(-1)).toBe('Не напоминать')
    expect(reminderLabel(0)).toBe('В момент начала')
    expect(reminderLabel(1)).toBe('За 1 минуту')
    expect(reminderLabel(15)).toBe('За 15 минут')
    expect(reminderLabel(60)).toBe('За час')
    expect(reminderLabel(120)).toBe('За 2 часа')
    expect(reminderLabel(1440)).toBe('За день')
    expect(reminderLabel(2880)).toBe('За 2 дня')
    expect(reminderLabel(90)).toBe('За 90 минут')
  })

  it('короткие и время дня', () => {
    expect([-1, 0, 10, 60, 120, 1440, 2880].map(reminderShortLabel)).toEqual([
      'Нет',
      'В начале',
      '10 мин',
      '1 ч',
      '2 ч',
      'За день',
      '2 дн',
    ])
    expect(dayTimeLabel(-1)).toBe('Выключено')
    expect(dayTimeLabel(9 * 60)).toBe('9:00')
    expect(dayTimeLabel(18 * 60 + 5)).toBe('18:05')
  })
})

describe('лимиты напоминаний — как на сервере', () => {
  it('упорядочивает и убирает повторы', () => {
    expect(normalizeReminders([10, 60, 10, 0])).toEqual([60, 10, 0])
  })

  it('проверяет границы и количество', () => {
    expect(remindersError(null)).toBeNull()
    expect(remindersError([])).toBeNull()
    expect(remindersError([0, 10080])).toBeNull()
    expect(remindersError([10, 10, 10, 10])).toBeNull() // после склейки повторов — одно
    expect(remindersError([1, 2, 3, 4])).toMatch(/Не больше 3/)
    expect(remindersError([-1])).toMatch(/от 0/)
    expect(remindersError([10081])).toMatch(/от 0/)
    expect(remindersError([1.5])).toMatch(/от 0/)
  })
})
