import { describe, expect, it } from 'vitest'
import {
  TIME_OPTIONS,
  findFreeSlots,
  firstFreeTime,
  fitDuration,
  nearestTimeOption,
  nextFreeTime,
  partOf,
  slotAt,
} from './calendar'
import type { CalendarEvent } from './types'

const ev = (id: string, start: number, end: number): CalendarEvent => ({
  id,
  title: id,
  start,
  end,
  badge: id === 'sleep' ? 'sleep' : 'work',
})
const h = (hours: number, minutes = 0) => hours * 60 + minutes

const DAY: CalendarEvent[] = [
  ev('sleep', h(6), h(8)),
  ev('routine', h(8), h(9)),
  ev('call', h(10, 30), h(11, 30)),
  ev('lunch', h(13), h(14)),
  ev('ux', h(15), h(16, 30)),
]

describe('slotAt', () => {
  it('находит соседние дела', () => {
    const slot = slotAt(DAY, h(9), 90)
    expect(slot.before?.title).toBe('routine')
    expect(slot.after?.title).toBe('call')
    expect(slot.conflicts).toEqual([])
  })

  it('видит пересечения, сон — тоже занятость', () => {
    expect(slotAt(DAY, h(10), 60).conflicts).toEqual(['call'])
    expect(slotAt(DAY, h(7), 30).conflicts).toEqual(['sleep'])
  })
})

describe('findFreeSlots', () => {
  it('окна от часа, не длиннее полутора часов', () => {
    const slots = findFreeSlots(DAY)
    expect(slots.map((s) => [s.start, s.end])).toEqual([
      [h(9), h(10, 30)],
      [h(11, 30), h(13)],
      [h(14), h(15)],
    ])
  })

  it('пустой день — окно с начала дня', () => {
    expect(findFreeSlots([], 1)[0]?.start).toBe(h(8))
  })
})

describe('выбор времени', () => {
  it('firstFreeTime пропускает занятое', () => {
    expect(firstFreeTime(DAY, 0)).toBe(h(9))
    expect(firstFreeTime(DAY, h(10))).toBe(h(11, 30))
  })

  it('TIME_OPTIONS покрывает все сутки, включая ночь', () => {
    expect(TIME_OPTIONS[0]).toBe(0)
    expect(TIME_OPTIONS.at(-1)).toBe(h(23, 30))
  })

  it('fitDuration не даёт выйти за полночь', () => {
    expect(fitDuration(h(23, 30), 60)).toBe(30)
    expect(fitDuration(h(9), 60)).toBe(60)
  })

  it('nextFreeTime предлагает время сразу после мешающего события', () => {
    // 10:00 на час задевает «call» (10:30–11:30) — ближайшее свободное начало его конец.
    expect(nextFreeTime(DAY, h(10), 60)).toBe(h(11, 30))
    // 13:30 на час: «lunch» до 14:00, дальше 14:00–15:00 свободно.
    expect(nextFreeTime(DAY, h(13, 30), 60)).toBe(h(14))
    expect(nextFreeTime([ev('late', h(22), h(24))], h(21, 30), 60)).toBeNull()
  })

  it('nearestTimeOption округляет до получаса', () => {
    expect(nearestTimeOption(h(9, 10))).toBe(h(9))
    expect(nearestTimeOption(h(9, 20))).toBe(h(9, 30))
  })

  it('partOf', () => {
    expect(partOf(h(9))).toBe('morning')
    expect(partOf(h(13))).toBe('afternoon')
    expect(partOf(h(20))).toBe('night')
    expect(partOf(h(2))).toBe('morning')
  })
})
