import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import { createHttpApi } from './http'

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('http api', () => {
  it('переводит даты и бронь в типы фронтенда', async () => {
    mockFetch(201, {
      id: 'bkg-1',
      place: { id: 'scramble', name: 'Scramble place' },
      date: '2026-10-21',
      start: 540,
      end: 630,
      guests: 2,
      invite: true,
      code: 'A-4821',
      status: 'confirmed',
    })
    const b = await createHttpApi().createBooking({
      placeId: 'scramble',
      date: new Date(2026, 9, 21),
      start: 540,
      end: 630,
      guests: 2,
      invite: true,
    })
    expect(b.date).toEqual(new Date(2026, 9, 21))
    expect(b.slot).toEqual({ start: 540, end: 630, conflicts: [] })
    expect(b.restaurant.name).toBe('Scramble place')
  })

  it('отправляет дату в формате ГГГГ-ММ-ДД', async () => {
    const fetch = mockFetch(200, [])
    await createHttpApi('http://api').getEvents(new Date(2026, 0, 5))
    expect(fetch).toHaveBeenCalledWith('http://api/api/events?date=2026-01-05', expect.anything())
  })

  it('показывает текст ошибки сервера', async () => {
    mockFetch(409, { error: 'Ambient bar закрыто в это время' })
    await expect(createHttpApi().cancelBooking('x')).rejects.toEqual(
      new ApiError(409, 'Ambient bar закрыто в это время'),
    )
  })

  it('числовые ключи месяца', async () => {
    mockFetch(200, { '8': ['work', 'food'] })
    expect(await createHttpApi().getMonthDots(2026, 9)).toEqual({ 8: ['work', 'food'] })
  })
})
