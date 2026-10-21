import { describe, expect, it } from 'vitest'
import { syncedLabel } from './labels'

describe('syncedLabel', () => {
  const now = new Date('2026-10-21T12:00:00')

  it('без даты — ещё не обновлялся', () => {
    expect(syncedLabel(undefined, now)).toBe('ещё не обновлялся')
  })

  it('минуты и часы со склонениями', () => {
    expect(syncedLabel('2026-10-21T11:59:40', now)).toBe('обновлено только что')
    expect(syncedLabel('2026-10-21T11:59:00', now)).toBe('обновлено 1 минуту назад')
    expect(syncedLabel('2026-10-21T11:55:00', now)).toBe('обновлено 5 минут назад')
    expect(syncedLabel('2026-10-21T09:00:00', now)).toBe('обновлено 3 часа назад')
  })

  it('вчера и раньше — с датой', () => {
    expect(syncedLabel('2026-10-20T08:30:00', now)).toBe('обновлено вчера в 08:30')
    expect(syncedLabel('2026-10-15T08:30:00', now)).toBe('обновлено 15 октября')
  })
})
