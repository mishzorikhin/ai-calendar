import { describe, expect, it } from 'vitest'
import { agoLabel, plural, pluralize } from './plural'

const EVENTS = ['событие', 'события', 'событий'] as const

describe('plural', () => {
  it.each([
    [1, 'событие'],
    [2, 'события'],
    [4, 'события'],
    [5, 'событий'],
    [11, 'событий'],
    [12, 'событий'],
    [21, 'событие'],
    [22, 'события'],
    [25, 'событий'],
    [0, 'событий'],
  ])('%i → %s', (n, word) => {
    expect(plural(n, EVENTS)).toBe(word)
  })

  it('pluralize добавляет число', () => {
    expect(pluralize(3, EVENTS)).toBe('3 события')
  })
})

describe('agoLabel', () => {
  it('говорит по-человечески, сколько прошло', () => {
    const now = new Date(2026, 9, 22, 12, 0)
    const ago = (min: number) => agoLabel(new Date(now.getTime() - min * 60_000), now)
    expect(ago(1)).toBe('только что')
    expect(ago(5)).toBe('5 минут назад')
    expect(ago(61)).toBe('1 час назад')
    expect(ago(3 * 60)).toBe('3 часа назад')
    expect(ago(25 * 60)).toBe('вчера')
    expect(ago(5 * 24 * 60)).toBe('5 дней назад')
    expect(ago(-10)).toBe('только что')
  })
})
