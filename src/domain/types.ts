export type Badge = 'sleep' | 'routine' | 'work' | 'food' | 'sport' | 'read'

export type CalendarEvent = {
  id: string
  title: string
  subtitle?: string
  /** Минуты от полуночи. */
  start: number
  end: number
  badge: Badge
  sleepGraph?: boolean
  highlight?: boolean
}

/** Событие, созданное пользователем вручную, привязано к дате. */
export type DatedEvent = CalendarEvent & { date: Date }

export type DayPartId = 'morning' | 'afternoon' | 'night'

export type DayPart = {
  id: DayPartId
  title: string
  from: number
  to: number
}

export type Slot = {
  start: number
  end: number
  before?: { title: string; at: number }
  after?: { title: string; at: number }
  /** События, с которыми пересекается выбранное время. */
  conflicts: string[]
}

export type Restaurant = {
  id: string
  name: string
  cuisine: string
  rating: number
  /** Минут пешком. */
  walkMinutes: number
  distance: string
  address: string
  price: string
  /** Часы работы в минутах от полуночи; закрытие после полуночи — больше 24 × 60. */
  opensAt: number
  closesAt: number
  description: string
  tint: string
  /** Фон-заглушка, пока фото грузится или если оно недоступно. */
  art: string
  photo: string
  tags: string[]
  /** Положение метки на радаре, в долях от радиуса (x, y от центра). */
  radar: readonly [number, number]
}

/** Что ассистент понял из запроса. Каждый параметр можно поправить до начала поиска. */
export type RequestParams = {
  dayOffset: number
  guests: number
  radiusKm: number
  invite: boolean
}

export type BookingStatus = 'confirmed' | 'cancelled'

export type Booking = {
  id: string
  restaurant: Restaurant
  slot: Slot
  date: Date
  guests: number
  invite: boolean
  code: string
  status: BookingStatus
}

export type Review = { name: string; initials: string; color: string; rating: number; text: string }

/** Новое событие пользователя (до сохранения). */
export type NewEvent = Pick<CalendarEvent, 'title' | 'start' | 'end'> & {
  date: Date
  subtitle?: string
  badge?: Badge
}

/** Запрос на бронь, которую ассистент подтвердил по телефону. */
export type NewBooking = {
  placeId: string
  date: Date
  start: number
  end: number
  guests: number
  invite: boolean
}

/** Значки событий по числам месяца. */
export type MonthDots = Readonly<Record<number, readonly Badge[]>>

export type TranscriptLine = { at: number; who: 'ai' | 'place'; text: string }

export type ChatMessage = { id: number; role: 'user' | 'ai'; text: string }

export type Person = {
  name: string
  /** Винительный падеж: «пригласить Глеба». */
  nameAccusative: string
  /** Дательный падеж: «Глебу отправлено приглашение». */
  nameDative: string
  initials: string
  photo: string
  color: string
}
