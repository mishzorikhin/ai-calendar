import { describe, expect, it } from 'vitest'
import { dragResult, isDraggable } from './drag'

const part = { from: 6 * 60, to: 12 * 60 }
const HOUR = 62

describe('dragResult', () => {
  it('сдвигает с шагом 5 минут', () => {
    // 31 px ≈ 30 минут; 2 px — меньше половины шага (5 мин ≈ 5,2 px), не двигаем.
    expect(dragResult(600, 660, 31, 'move', part, HOUR)).toEqual({ start: 630, end: 690 })
    expect(dragResult(600, 660, 2, 'move', part, HOUR)).toEqual({ start: 600, end: 660 })
    expect(dragResult(600, 660, -62, 'move', part, HOUR)).toEqual({ start: 540, end: 600 })
  })

  it('не выходит за границы части суток', () => {
    expect(dragResult(600, 660, 1000, 'move', part, HOUR)).toEqual({ start: 660, end: 720 })
    expect(dragResult(400, 460, -1000, 'move', part, HOUR)).toEqual({ start: 360, end: 420 })
  })

  it('меняет длительность, но не короче 15 минут', () => {
    expect(dragResult(600, 660, 31, 'resize', part, HOUR)).toEqual({ start: 600, end: 690 })
    expect(dragResult(600, 660, -1000, 'resize', part, HOUR)).toEqual({ start: 600, end: 615 })
    expect(dragResult(600, 660, 10000, 'resize', part, HOUR)).toEqual({ start: 600, end: 720 })
  })

  it('таскать можно только свои однодневные события со временем', () => {
    expect(isDraggable({})).toBe(true)
    expect(isDraggable({ readOnly: true })).toBe(false)
    expect(isDraggable({ allDay: true })).toBe(false)
    expect(isDraggable({ invite: {} })).toBe(false)
    expect(isDraggable({ endDate: '2026-10-23' })).toBe(false)
  })
})
