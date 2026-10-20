import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { createLocalApi } from './local'

class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  clear() {
    this.map.clear()
  }
  getItem(key: string) {
    return this.map.get(key) ?? null
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
}

const day = new Date(2026, 9, 21)

describe('local api', () => {
  it('бронь появляется в дне и месяце, отмена убирает её', async () => {
    const api = createLocalApi(new MemoryStorage())
    const booking = await api.createBooking({
      placeId: 'scramble',
      date: day,
      start: 540,
      end: 630,
      guests: 2,
      invite: true,
    })
    expect(booking.code).toBe('A-4821')

    const events = await api.getEvents(day)
    expect(events.some((e) => e.id === `booking-${booking.id}`)).toBe(true)
    expect((await api.getMonthDots(2026, 9))[21]).toContain('food')

    await api.cancelBooking(booking.id)
    expect((await api.getEvents(day)).some((e) => e.id === `booking-${booking.id}`)).toBe(false)
  })

  it('не бронирует закрытое место', async () => {
    const api = createLocalApi(new MemoryStorage())
    await expect(
      api.createBooking({ placeId: 'ambient', date: day, start: 540, end: 630, guests: 2, invite: false }),
    ).rejects.toBeInstanceOf(ApiError)
  })

  it('сохраняет данные между запусками', async () => {
    const storage = new MemoryStorage()
    const first = createLocalApi(storage)
    await first.createEvent({ title: 'Звонок маме', date: day, start: 600, end: 660 })
    await first.addMessage('user', 'Привет')

    const second = createLocalApi(storage)
    expect((await second.getEvents(day)).some((e) => e.title === 'Звонок маме')).toBe(true)
    expect((await second.getMessages()).at(-1)?.text).toBe('Привет')
  })

  it('проверяет вход так же, как сервер', async () => {
    const api = createLocalApi(new MemoryStorage())
    const event = { date: day, start: 600, end: 660 }
    await expect(api.createEvent({ ...event, title: '  ' })).rejects.toMatchObject({ status: 400 })
    await expect(api.createEvent({ ...event, title: 'я'.repeat(121) })).rejects.toMatchObject({ status: 400 })
    await expect(api.createEvent({ ...event, title: 'x', subtitle: 'я'.repeat(201) })).rejects.toMatchObject({
      status: 400,
    })
    await expect(api.createEvent({ ...event, title: 'x', end: 1500 })).rejects.toMatchObject({ status: 400 })
    await expect(api.createEvent({ ...event, title: 'x', start: -5 })).rejects.toMatchObject({ status: 400 })

    const booking = { placeId: 'scramble', date: day, start: 540, end: 630, guests: 2, invite: false }
    await expect(api.createBooking({ ...booking, guests: 9 })).rejects.toMatchObject({ status: 400 })
    await expect(api.createBooking({ ...booking, guests: 0 })).rejects.toMatchObject({ status: 400 })
    await expect(api.createBooking({ ...booking, end: 500 })).rejects.toMatchObject({ status: 400 })

    await expect(api.addMessage('user', '   ')).rejects.toMatchObject({ status: 400 })
    await expect(api.addMessage('user', 'я'.repeat(2001))).rejects.toMatchObject({ status: 400 })
  })

  it('не даёт забронировать пересекающееся время; после отмены можно', async () => {
    const api = createLocalApi(new MemoryStorage())
    const input = { placeId: 'scramble', date: day, start: 540, end: 630, guests: 2, invite: false }
    const first = await api.createBooking(input)
    await expect(api.createBooking({ ...input, start: 600, end: 700 })).rejects.toMatchObject({ status: 409 })
    await api.createBooking({ ...input, start: 630, end: 700 })
    await api.cancelBooking(first.id)
    await api.createBooking(input)
  })
})
