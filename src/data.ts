import { addDays, dayKey, startOfDay } from './lib/dates'

export type Badge = 'sleep' | 'routine' | 'work' | 'food' | 'sport' | 'read'

export type CalendarEvent = {
  id: string
  title: string
  subtitle?: string
  start: number // минуты от полуночи
  end: number
  badge: Badge
  sleepGraph?: boolean
  highlight?: boolean
}

export type DayPart = {
  id: 'morning' | 'afternoon' | 'night'
  title: string
  from: number
  to: number
}

export const DAY_PARTS: DayPart[] = [
  { id: 'morning', title: 'Утро', from: 6 * 60, to: 12 * 60 },
  { id: 'afternoon', title: 'День', from: 12 * 60, to: 18 * 60 },
  { id: 'night', title: 'Вечер', from: 18 * 60, to: 24 * 60 },
]

const BASE_EVENTS: CalendarEvent[] = [
  {
    id: 'sleep',
    title: 'Сон',
    subtitle: '4 ч глубокого',
    start: 6 * 60,
    end: 8 * 60,
    badge: 'sleep',
    sleepGraph: true,
  },
  { id: 'routine', title: 'Утренняя рутина', start: 8 * 60, end: 9 * 60, badge: 'routine' },
  {
    id: 'vc',
    title: 'Подготовка к созвону',
    subtitle: 'A301 — переговорная',
    start: 10 * 60 + 30,
    end: 11 * 60 + 30,
    badge: 'work',
  },
  { id: 'lunch', title: 'Обед с командой', subtitle: 'Water Bar', start: 13 * 60, end: 14 * 60, badge: 'food' },
  {
    id: 'ux',
    title: 'Встреча по UX',
    subtitle: 'Продуктовая команда',
    start: 15 * 60,
    end: 16 * 60 + 30,
    badge: 'work',
  },
  { id: 'gym', title: 'Тренировка', subtitle: 'Зал на Покровке', start: 17 * 60, end: 18 * 60, badge: 'sport' },
  { id: 'dinner', title: 'Ужин', subtitle: 'Дома', start: 19 * 60 + 30, end: 20 * 60 + 30, badge: 'food' },
  { id: 'read', title: 'Чтение', subtitle: '30 страниц', start: 22 * 60, end: 23 * 60, badge: 'read' },
]

export function eventsFor(date: Date, booking: Booking | null): CalendarEvent[] {
  // Немного разнообразия между днями, чтобы смена дня в ленте недели была заметна.
  const seed = date.getDate() % 3
  const list = BASE_EVENTS.filter((e) => !(seed === 1 && e.id === 'gym') && !(seed === 2 && e.id === 'lunch'))
  if (booking && dayKey(booking.date) === dayKey(date)) {
    list.push({
      id: 'booked',
      title: `Завтрак · ${booking.restaurant.name}`,
      subtitle: 'с Глебом',
      start: booking.slot.start,
      end: booking.slot.end,
      badge: 'food',
      highlight: true,
    })
  }
  return list.sort((a, b) => a.start - b.start)
}

/** Цветные точки событий в месячной сетке. */
export function monthDots(date: Date): Badge[] {
  const d = date.getDate()
  const pattern: Record<number, Badge[]> = {
    1: ['food'],
    3: ['work'],
    8: ['work', 'food'],
    11: ['work'],
    14: ['sport'],
    17: ['work', 'routine'],
    19: ['food'],
    22: ['sport', 'food'],
    25: ['work'],
    27: ['work', 'routine'],
    30: ['food'],
  }
  return pattern[d] ?? []
}

export type Slot = { start: number; end: number; before: string; beforeAt: number; after: string; afterAt: number }

export const SLOTS: Slot[] = [
  {
    start: 9 * 60,
    end: 10 * 60 + 30,
    before: 'Утренняя рутина',
    beforeAt: 8 * 60,
    after: 'Подготовка к созвону',
    afterAt: 10 * 60 + 30,
  },
  {
    start: 14 * 60,
    end: 15 * 60,
    before: 'Обед с командой',
    beforeAt: 13 * 60,
    after: 'Встреча по UX',
    afterAt: 15 * 60,
  },
  {
    start: 18 * 60 + 15,
    end: 19 * 60 + 30,
    before: 'Тренировка',
    beforeAt: 17 * 60,
    after: 'Ужин',
    afterAt: 19 * 60 + 30,
  },
]

export type Restaurant = {
  id: string
  name: string
  cuisine: string
  rating: number
  minutes: number
  distance: string
  address: string
  hours: string
  description: string
  tint: string
  /** Фон-заглушка, пока фото грузится или если оно недоступно. */
  art: string
  photo: string
  tags: string[]
  /** Положение метки на радаре, в долях от радиуса (x, y от центра). */
  radar: [number, number]
}

export const RESTAURANTS: Restaurant[] = [
  {
    id: 'scramble',
    name: 'Scramble place',
    cuisine: 'Завтраки весь день',
    rating: 4.9,
    minutes: 10,
    distance: '650 м',
    address: 'Пятницкая ул., 12',
    hours: 'Открыто до 22:00',
    description:
      'Уютное место для неспешных завтраков: свежая выпечка, панкейки с ягодами, домашние джемы и хороший кофе.',
    tint: 'rgba(132, 98, 70, 0.62)',
    art: 'radial-gradient(120% 90% at 20% 30%, #f3d9b8 0%, rgba(243,217,184,0) 55%), radial-gradient(80% 70% at 80% 70%, #c9875a 0%, rgba(201,135,90,0) 60%), radial-gradient(60% 50% at 65% 25%, #fff3e0 0%, rgba(255,243,224,0) 60%), linear-gradient(160deg, #e8c39c 0%, #b07a52 55%, #6f4a33 100%)',
    photo: 'https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?auto=format&fit=crop&w=900&q=70',
    tags: ['Завтраки', 'Выпечка', 'Кофе', 'Тихо'],
    radar: [0.32, 0.5],
  },
  {
    id: 'ambient',
    name: 'Ambient bar',
    cuisine: 'Европейская кухня',
    rating: 4.8,
    minutes: 25,
    distance: '1,9 км',
    address: 'Малая Ордынка, 7',
    hours: 'Открыто до 01:00',
    description: 'Камерная атмосфера, сезонные продукты и большой выбор крафтового пива от местных пивоварен.',
    tint: 'rgba(78, 84, 52, 0.62)',
    art: 'radial-gradient(90% 70% at 75% 25%, #f1e4c2 0%, rgba(241,228,194,0) 50%), radial-gradient(90% 80% at 25% 75%, #5d7146 0%, rgba(93,113,70,0) 65%), linear-gradient(170deg, #9aa57a 0%, #56603d 55%, #2f3523 100%)',
    photo: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=900&q=70',
    tags: ['Бар', 'Крафт', 'Поздно'],
    radar: [-0.72, -0.48],
  },
  {
    id: 'green',
    name: 'Green cup',
    cuisine: 'Кофейня',
    rating: 4.3,
    minutes: 15,
    distance: '1,1 км',
    address: 'Новокузнецкая ул., 20',
    hours: 'Открыто до 21:00',
    description: 'Светлая кофейня с большими окнами, боулами и десертами без сахара.',
    tint: 'rgba(70, 104, 96, 0.6)',
    art: 'radial-gradient(90% 70% at 30% 30%, #e8f1e6 0%, rgba(232,241,230,0) 55%), radial-gradient(80% 70% at 75% 75%, #6f9c8e 0%, rgba(111,156,142,0) 60%), linear-gradient(160deg, #b9d3c5 0%, #6d978a 55%, #3c5a52 100%)',
    photo: 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&w=900&q=70',
    tags: ['Кофе', 'Боулы', 'Ноутбук-friendly'],
    radar: [0.66, -0.78],
  },
]

export const REVIEWS = [
  {
    name: 'Анна',
    initials: 'А',
    color: '#f3c9b9',
    rating: 5,
    text: 'Лучшие панкейки в районе, приходим каждое воскресенье.',
  },
  {
    name: 'Дмитрий',
    initials: 'Д',
    color: '#c9d4f3',
    rating: 5,
    text: 'Тихо, вкусный кофе, можно спокойно поговорить.',
  },
  { name: 'Мария', initials: 'М', color: '#d6eccb', rating: 4, text: 'Утром бывает очередь, но бронь держат чётко.' },
]

export const FRIEND = {
  name: 'Глеб',
  initials: 'Г',
  photo: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=160&q=70',
}

export const ME = {
  initials: 'Я',
  photo: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=160&q=70',
}

export const DEMO_PROMPT = 'Запланируй завтрак в уютном ресторане рядом со мной с моим другом Глебом'

export type TranscriptLine = { at: number; who: 'ai' | 'place'; text: string }

export const TRANSCRIPT: TranscriptLine[] = [
  { at: 1, who: 'ai', text: 'Здравствуйте! Хочу забронировать столик на двоих завтра на 9:00.' },
  { at: 4, who: 'place', text: 'Доброе утро! Да, на 9:00 есть столик у окна.' },
  { at: 7, who: 'ai', text: 'Отлично, подойдёт. Гостей будет двое.' },
  { at: 10, who: 'place', text: 'Записала. Ждём вас в 9:00!' },
]

export const TRANSCRIPT_DONE_AT = 12

export type Booking = {
  restaurant: Restaurant
  slot: Slot
  date: Date
}

export function bookingDate(): Date {
  return addDays(startOfDay(new Date()), 1)
}

export type ChatCategory = { id: string; label: string; prompts: string[] }

export const CHAT_CATEGORIES: ChatCategory[] = [
  {
    id: 'food',
    label: 'Еда',
    prompts: [DEMO_PROMPT, 'Найди ресторан для ужина на четверых', 'Закажи столик на обед в пятницу'],
  },
  { id: 'travel', label: 'Путешествия', prompts: ['Спланируй отпуск в Париже', 'Найди билеты на выходные'] },
  { id: 'activity', label: 'Активности', prompts: ['Запланируй тренировку 3 раза в неделю', 'Найди корт для тенниса'] },
  { id: 'work', label: 'Работа', prompts: ['Запланируй встречу с командой', 'Освободи утро в четверг'] },
]

export const QUICK_PROMPTS = [
  { label: 'Запланировать завтрак', prompt: DEMO_PROMPT },
  { label: 'Запланировать встречу', prompt: 'Запланируй встречу с командой на завтра' },
  { label: 'Спланировать отпуск', prompt: 'Спланируй мой отпуск целиком' },
]
