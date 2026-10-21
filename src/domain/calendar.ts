import type { CalendarEvent, DayPart, DayPartId, Slot } from './types'

export const DAY_PARTS: readonly DayPart[] = [
  { id: 'morning', title: 'Утро', from: 6 * 60, to: 12 * 60 },
  { id: 'afternoon', title: 'День', from: 12 * 60, to: 18 * 60 },
  { id: 'night', title: 'Вечер', from: 18 * 60, to: 24 * 60 },
]

/** Часть суток, в которую попадает время; до 6 утра считаем утром. */
export function partOf(mins: number): DayPartId {
  return DAY_PARTS.find((p) => mins >= p.from && mins < p.to)?.id ?? 'morning'
}

const DAY_START = 8 * 60
const DAY_END = 21 * 60

/** Варианты времени для ручного выбора: каждые полчаса, круглые сутки — ночные смены и поздние звонки тоже бывают. */
export const TIME_OPTIONS: readonly number[] = Array.from({ length: 48 }, (_, i) => i * 30)

const MORNING = 6 * 60

/** Длительность, которая помещается до конца суток: событие не переходит через полночь. */
export function fitDuration(start: number, duration: number): number {
  return Math.max(Math.min(duration, 24 * 60 - start), 1)
}

/** Слот заданной длины с соседними делами и пересечениями. */
export function slotAt(events: readonly CalendarEvent[], start: number, duration = 90): Slot {
  const end = start + duration
  const before = events.findLast((e) => e.end <= start)
  const after = events.find((e) => e.start >= end)
  return {
    start,
    end,
    before: before && { title: before.title, at: before.start },
    after: after && { title: after.title, at: after.start },
    conflicts: events.filter((e) => e.start < end && e.end > start).map((e) => e.title),
  }
}

/** Свободные окна от часа и дольше (каждое не длиннее полутора часов). */
export function findFreeSlots(events: readonly CalendarEvent[], limit = 3): Slot[] {
  const busy = events
    .filter((e) => e.end > DAY_START && e.start < DAY_END)
    .map((e) => [e.start, e.end] as const)
    .sort((a, b) => a[0] - b[0])
  const slots: Slot[] = []
  let cursor = DAY_START
  for (const [start, end] of [...busy, [DAY_END, DAY_END] as const]) {
    if (start - cursor >= 60) slots.push(slotAt(events, cursor, Math.min(start - cursor, 90)))
    cursor = Math.max(cursor, end)
    if (slots.length >= limit) break
  }
  return slots
}

/** Ближайшее время из TIME_OPTIONS. */
export function nearestTimeOption(mins: number): number {
  return TIME_OPTIONS.reduce((best, t) => (Math.abs(t - mins) < Math.abs(best - mins) ? t : best), TIME_OPTIONS[0] ?? 0)
}

/** Первое свободное время (шаг 30 минут) не раньше `from`; по умолчанию не раньше рабочего утра. */
export function firstFreeTime(events: readonly CalendarEvent[], from: number, duration = 60): number {
  const free = (t: number) => slotAt(events, t, duration).conflicts.length === 0
  const floor = Math.max(from, DAY_START)
  return (
    TIME_OPTIONS.find((t) => t >= floor && free(t)) ?? TIME_OPTIONS.find((t) => t >= MORNING && free(t)) ?? DAY_START
  )
}
