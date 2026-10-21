import { describe, expect, it } from 'vitest'
import { normalizeReminders, remindersError } from './limits'
import {
  alarmPresets,
  alarmWhenLabel,
  dayTimeLabel,
  decodeQuiet,
  encodeQuiet,
  quietLabel,
  reminderLabel,
  reminderShortLabel,
} from './reminders'

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

describe('тихие часы и свои напоминания', () => {
  it('тихие часы — одним числом туда и обратно', () => {
    expect(encodeQuiet(-1, -1)).toBe(-1)
    const code = encodeQuiet(23 * 60, 7 * 60)
    expect(decodeQuiet(code)).toEqual({ quietFrom: 1380, quietTo: 420 })
    expect(quietLabel(code)).toBe('23:00–7:00')
    expect(quietLabel(-1)).toBe('Нет')
    expect(decodeQuiet(-1)).toEqual({ quietFrom: -1, quietTo: -1 })
  })

  it('быстрые варианты времени', () => {
    const morning = new Date(2026, 9, 20, 10, 0)
    const labels = alarmPresets(morning).map((p) => p.label)
    expect(labels).toEqual([
      'Через 15 мин',
      'Через 30 мин',
      'Через час',
      'Через 3 часа',
      'Вечером в 19:00',
      'Завтра в 9:00',
    ])
    const evening = alarmPresets(new Date(2026, 9, 20, 18, 30))
    expect(evening.map((p) => p.label)).not.toContain('Вечером в 19:00')
    expect(evening.at(-1)?.at).toEqual(new Date(2026, 9, 21, 9, 0))
  })

  it('когда придёт', () => {
    const now = new Date(2026, 9, 20, 10, 0)
    expect(alarmWhenLabel(new Date(2026, 9, 20, 18, 0), now)).toBe('Сегодня в 18:00')
    expect(alarmWhenLabel(new Date(2026, 9, 21, 9, 5), now)).toBe('Завтра в 9:05')
  })
})
