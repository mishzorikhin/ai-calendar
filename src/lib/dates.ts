export const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

export const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]

export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

export const WEEKDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота']

/** Короткие названия дней, неделя начинается с понедельника. */
export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** Индекс дня недели, где 0 — понедельник. */
export function weekdayIndex(d: Date): number {
  return (d.getDay() + 6) % 7
}

export function isWeekend(d: Date): boolean {
  return weekdayIndex(d) >= 5
}

export function startOfWeek(d: Date): Date {
  return addDays(startOfDay(d), -weekdayIndex(d))
}

/** Ячейки месячной сетки: null — пустые клетки до первого числа. */
export function monthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1)
  const days = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = Array.from({ length: weekdayIndex(first) }, () => null)
  for (let i = 1; i <= days; i++) cells.push(new Date(year, month, i))
  return cells
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Время в минутах от полуночи → «09:30». */
export function formatMinutes(mins: number): string {
  return `${pad2(Math.floor(mins / 60) % 24)}:${pad2(mins % 60)}`
}

/** «09:30» (как отдаёт `<input type="time">`) → минуты от полуночи; null, если строка не время. */
export function parseMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(s)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h < 24 && min < 60 ? h * 60 + min : null
}

export function formatTimer(seconds: number): string {
  return `${pad2(Math.floor(seconds / 60))}:${pad2(seconds % 60)}`
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** «Сегодня», «Завтра», «Послезавтра» или «ср, 22 октября». */
export function relativeDayLabel(date: Date, today: Date = new Date()): string {
  const diff = Math.round((startOfDay(date).getTime() - startOfDay(today).getTime()) / 86_400_000)
  if (diff === 0) return 'Сегодня'
  if (diff === 1) return 'Завтра'
  if (diff === 2) return 'Послезавтра'
  return `${WEEKDAYS_SHORT[weekdayIndex(date)]}, ${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]}`
}

/** Дата для API: «2026-10-20» (локальная, без часового пояса). */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function fromISODate(s: string): Date {
  const [y = 1970, m = 1, d = 1] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
