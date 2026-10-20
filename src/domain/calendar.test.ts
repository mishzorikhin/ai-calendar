import { describe, expect, it } from 'vitest'
import { findFreeSlots, firstFreeTime, nearestTimeOption, partOf, slotAt } from './calendar'
import type { CalendarEvent } from './types'

const ev = (id: string, start: number, end: number): CalendarEvent => ({ id, title: id, start, end, badge: 'work' })
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

  it('видит пересечения, но не считает сон занятостью', () => {
    expect(slotAt(DAY, h(10), 60).conflicts).toEqual(['call'])
    expect(slotAt(DAY, h(7), 30).conflicts).toEqual([])
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
