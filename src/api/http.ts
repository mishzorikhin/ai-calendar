import type { Badge, Booking, BookingStatus, CalendarEvent, ChatMessage, DatedEvent, Restaurant } from '../domain/types'
import { fromISODate, toISODate } from '../lib/dates'
import { ApiError, type CalendarApi } from './api'

// Форматы ответов сервера (server/internal/model).
type EventDTO = CalendarEvent & { date: string }
type BookingDTO = {
  id: string
  place: Restaurant
  date: string
  start: number
  end: number
  guests: number
  invite: boolean
  code: string
  status: BookingStatus
}

const toBooking = (b: BookingDTO): Booking => ({
  id: b.id,
  restaurant: b.place,
  slot: { start: b.start, end: b.end, conflicts: [] },
  date: fromISODate(b.date),
  guests: b.guests,
  invite: b.invite,
  code: b.code,
  status: b.status,
})

const toEvent = ({ date, ...e }: EventDTO): DatedEvent => ({ ...e, date: fromISODate(date) })

export function createHttpApi(baseUrl = ''): CalendarApi {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response
    try {
      res = await fetch(baseUrl + path, {
        ...init,
        headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      })
    } catch {
      throw new ApiError(0, 'Нет соединения с сервером')
    }
    if (res.status === 204) return undefined as T
    const body: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      const message =
        body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error
          : `Ошибка сервера (${res.status})`
      throw new ApiError(res.status, message)
    }
    return body as T
  }

  const post = <T>(path: string, data: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(data) })

  return {
    mode: 'server',
    async getEvents(date) {
      const list = await request<EventDTO[]>(`/api/events?date=${toISODate(date)}`)
      return list.map(toEvent)
    },
    async createEvent(input) {
      return toEvent(await post<EventDTO>('/api/events', { ...input, date: toISODate(input.date) }))
    },
    async getMonthDots(year, month) {
      const raw = await request<Record<string, Badge[]>>(`/api/month?year=${year}&month=${month + 1}`)
      return Object.fromEntries(Object.entries(raw).map(([day, badges]) => [Number(day), badges]))
    },
    getPlaces: () => request<Restaurant[]>('/api/places'),
    getReviews: (placeId) => request(`/api/places/${encodeURIComponent(placeId)}/reviews`),
    async getBookings() {
      return (await request<BookingDTO[]>('/api/bookings')).map(toBooking)
    },
    async createBooking(input) {
      return toBooking(await post<BookingDTO>('/api/bookings', { ...input, date: toISODate(input.date) }))
    },
    async cancelBooking(id) {
      return toBooking(await request<BookingDTO>(`/api/bookings/${encodeURIComponent(id)}`, { method: 'DELETE' }))
    },
    getMessages: () => request<ChatMessage[]>('/api/messages'),
    addMessage: (role, text) => post<ChatMessage>('/api/messages', { role, text }),
  }
}

/** Сервер доступен, если /api/health отвечает быстро и правильно. */
export async function probeServer(baseUrl = '', timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return false
    const body: unknown = await res.json()
    return !!body && typeof body === 'object' && 'status' in body && body.status === 'ok'
  } catch {
    return false
  }
}
