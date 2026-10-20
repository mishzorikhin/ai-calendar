import { describe, expect, it } from 'vitest'
import { plural, pluralize } from './plural'

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
