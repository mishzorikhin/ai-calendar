import { describe, expect, it } from 'vitest'
import { dataUrlBytes, fitSize } from './image'

describe('image', () => {
  it('уменьшает по длинной стороне и не увеличивает маленькие', () => {
    expect(fitSize(4000, 3000)).toEqual({ width: 1600, height: 1200 })
    expect(fitSize(1170, 2532)).toEqual({ width: 739, height: 1600 })
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('считает байты data URL без префикса и выравнивания', () => {
    expect(dataUrlBytes('data:image/jpeg;base64,AAAA')).toBe(3)
    expect(dataUrlBytes('data:image/jpeg;base64,AAA=')).toBe(2)
    expect(dataUrlBytes('data:image/jpeg;base64,AA==')).toBe(1)
  })
})
