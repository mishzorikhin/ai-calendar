import type {
  Booking,
  CalendarEvent,
  ChatMessage,
  DatedEvent,
  MonthDots,
  NewBooking,
  NewEvent,
  Restaurant,
  Review,
} from '../domain/types'

/**
 * Источник данных приложения. Две реализации:
 * - `server` — Go-бэкенд (server/), данные общие и хранятся на сервере;
 * - `local` — без сервера (GitHub Pages, превью): моки и localStorage этого браузера.
 */
export interface CalendarApi {
  readonly mode: 'server' | 'local'
  /** Все события дня: расписание, брони, события пользователя — по времени начала. */
  getEvents(date: Date): Promise<CalendarEvent[]>
  createEvent(input: NewEvent): Promise<DatedEvent>
  /** Месяц с 0, как в Date. */
  getMonthDots(year: number, month: number): Promise<MonthDots>
  getPlaces(): Promise<Restaurant[]>
  getReviews(placeId: string): Promise<Review[]>
  /** Брони, новые первыми. */
  getBookings(): Promise<Booking[]>
  createBooking(input: NewBooking): Promise<Booking>
  cancelBooking(id: string): Promise<Booking>
  getMessages(): Promise<ChatMessage[]>
  addMessage(role: ChatMessage['role'], text: string): Promise<ChatMessage>
}

/** Ошибка API с текстом, который можно показать пользователю. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}
