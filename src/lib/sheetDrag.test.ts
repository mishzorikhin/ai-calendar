import { describe, expect, it } from 'vitest'
import { backdropOpacity, decideDrag, sheetOffset, shouldClose } from './sheetDrag'

describe('decideDrag', () => {
  it('ждёт, пока палец не сдвинется заметно', () => {
    expect(decideDrag(2, 3, null)).toBe('pending')
  })

  it('горизонтальный жест отдаёт браузеру — ленты чипов листаются', () => {
    expect(decideDrag(20, 8, null)).toBe('native')
    expect(decideDrag(-20, 8, { atTop: true, canScroll: true })).toBe('native')
  })

  it('за непрокручиваемую часть шторка тянется в любую сторону', () => {
    expect(decideDrag(0, 20, null)).toBe('sheet')
    expect(decideDrag(0, -20, { atTop: true, canScroll: false })).toBe('sheet')
  })

  it('прокрутка вверху: вниз — шторка, вверх — прокрутка', () => {
    expect(decideDrag(1, 20, { atTop: true, canScroll: true })).toBe('sheet')
    expect(decideDrag(1, -20, { atTop: true, canScroll: true })).toBe('native')
  })

  it('прокрученное содержимое сначала прокручивается обратно', () => {
    expect(decideDrag(0, 20, { atTop: false, canScroll: true })).toBe('native')
  })
})

describe('sheetOffset', () => {
  it('вниз — за пальцем, вверх — почти не двигается', () => {
    expect(sheetOffset(80)).toBe(80)
    expect(sheetOffset(-100)).toBe(-5)
  })
})

describe('shouldClose', () => {
  it('закрывает при длинном или быстром смахивании', () => {
    expect(shouldClose(150, 0)).toBe(true)
    expect(shouldClose(30, 900)).toBe(true)
    expect(shouldClose(60, 200)).toBe(false)
  })
})

describe('backdropOpacity', () => {
  it('светлеет по мере смахивания, но не до конца', () => {
    expect(backdropOpacity(0)).toBe(1)
    expect(backdropOpacity(-20)).toBe(1)
    expect(backdropOpacity(250)).toBe(0.5)
    expect(backdropOpacity(2000)).toBe(0.35)
  })
})
