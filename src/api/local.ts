import { LIMITS, isValidRange } from '../domain/limits'
import { isOpenAt } from '../domain/restaurants'
import type { Booking, ChatMessage, DatedEvent } from '../domain/types'
import { fromISODate, toISODate } from '../lib/dates'
import { eventsFor, monthDotsFor } from '../mocks/calendar'
import { RESTAURANTS } from '../mocks/restaurants'
import { REVIEWS } from '../mocks/reviews'
import { ApiError, type CalendarApi } from './api'

const STORAGE_KEY = 'ai-calendar:data:v1'
const FIRST_CODE = 4821

type Stored<T extends { date: Date }> = Omit<T, 'date'> & { date: string }

type Snapshot = {
  events: Stored<DatedEvent>[]
  bookings: Stored<Booking>[]
  messages: ChatMessage[]
  nextId: number
}

const GREETING: ChatMessage = { id: 0, role: 'ai', text: 'Чем могу помочь?' }

function emptySnapshot(): Snapshot {
  return { events: [], bookings: [], messages: [GREETING], nextId: 1 }
}

function load(storage: Storage | null): Snapshot {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    return raw ? { ...emptySnapshot(), ...(JSON.parse(raw) as Partial<Snapshot>) } : emptySnapshot()
  } catch {
    return emptySnapshot()
  }
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Работа без сервера: моки + данные пользователя в localStorage этого браузера.
 * Повторяет правила сервера (проверки, номер брони, отмена), чтобы UI вёл себя одинаково.
 */
export function createLocalApi(storage: Storage | null = safeStorage()): CalendarApi {
  let data = load(storage)

  const save = () => {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      /* хранилище недоступно — данные живут до перезагрузки */
    }
  }
  const events = (): DatedEvent[] => data.events.map((e) => ({ ...e, date: fromISODate(e.date) }))
  const bookings = (): Booking[] => data.bookings.map((b) => ({ ...b, date: fromISODate(b.date) }))
  const nextId = (prefix: string) => `${prefix}-${data.nextId++}`
  // Имитируем сеть: ответ асинхронный, как у сервера.
  const reply = <T>(value: T) => Promise.resolve(value)

  return {
    mode: 'local',
    getEvents: (date) => reply(eventsFor(date, bookings(), events())),
    createEvent(input) {
      const title = input.title.trim()
      const subtitle = input.subtitle?.trim()
      if (!title || title.length > LIMITS.title)
        return Promise.reject(new ApiError(400, `Название обязательно и не длиннее ${LIMITS.title} символов`))
      if (subtitle && subtitle.length > LIMITS.subtitle)
        return Promise.reject(new ApiError(400, `Подзаголовок не длиннее ${LIMITS.subtitle} символов`))
      if (!isValidRange(input.start, input.end)) return Promise.reject(new ApiError(400, 'Время задано неверно'))
      const event: DatedEvent = {
        id: nextId('evt'),
        title,
        subtitle,
        start: input.start,
        end: input.end,
        badge: input.badge ?? 'routine',
        highlight: true,
        date: input.date,
      }
      data.events.push({ ...event, date: toISODate(event.date) })
      save()
      return reply(event)
    },
    getMonthDots: (year, month) => reply(monthDotsFor(year, month, bookings(), events())),
    getPlaces: () => reply([...RESTAURANTS]),
    getReviews: () => reply([...REVIEWS]),
    getBookings: () => reply(bookings().reverse()),
    createBooking(input) {
      const place = RESTAURANTS.find((r) => r.id === input.placeId)
      if (!place) return Promise.reject(new ApiError(404, 'Место не найдено'))
      if (!isValidRange(input.start, input.end)) return Promise.reject(new ApiError(400, 'Время задано неверно'))
      if (!Number.isInteger(input.guests) || input.guests < LIMITS.minGuests || input.guests > LIMITS.maxGuests)
        return Promise.reject(new ApiError(400, `Гостей должно быть от ${LIMITS.minGuests} до ${LIMITS.maxGuests}`))
      if (!isOpenAt(place, input.start)) return Promise.reject(new ApiError(409, `${place.name} закрыто в это время`))
      const date = toISODate(input.date)
      const overlaps = data.bookings.some(
        (b) => b.status === 'confirmed' && b.date === date && input.start < b.slot.end && b.slot.start < input.end,
      )
      if (overlaps) return Promise.reject(new ApiError(409, 'Это время уже занято другой бронью'))
      const booking: Booking = {
        id: nextId('bkg'),
        restaurant: place,
        slot: { start: input.start, end: input.end, conflicts: [] },
        date: input.date,
        guests: input.guests,
        invite: input.invite,
        code: `A-${FIRST_CODE + data.bookings.length}`,
        status: 'confirmed',
      }
      data.bookings.push({ ...booking, date: toISODate(booking.date) })
      save()
      return reply(booking)
    },
    cancelBooking(id) {
      const stored = data.bookings.find((b) => b.id === id)
      if (!stored) return Promise.reject(new ApiError(404, 'Бронь не найдена'))
      stored.status = 'cancelled'
      save()
      return reply({ ...stored, date: fromISODate(stored.date) })
    },
    getMessages: () => reply([...data.messages]),
    addMessage(role, text) {
      const trimmed = text.trim()
      if (!trimmed || trimmed.length > LIMITS.message)
        return Promise.reject(new ApiError(400, `Текст обязателен и не длиннее ${LIMITS.message} символов`))
      const message: ChatMessage = { id: (data.messages.at(-1)?.id ?? 0) + 1, role, text: trimmed }
      data = { ...data, messages: [...data.messages, message] }
      save()
      return reply(message)
    },
  }
}
