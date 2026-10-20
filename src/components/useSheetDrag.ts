import { animate, useMotionValue, type MotionValue } from 'framer-motion'
import { useEffect, useEffectEvent, type RefObject } from 'react'
import { backdropOpacity, decideDrag, sheetOffset, shouldClose, type ScrollState } from '../lib/sheetDrag'
import { softSpring } from '../lib/motion'

/** Поля ввода мышью не тянем — там выделяют текст. Пальцем — можно, как в iOS. */
const MOUSE_IGNORE = 'input, textarea, select, [contenteditable="true"]'

type Gesture = {
  startX: number
  startY: number
  scroll: ScrollState
  state: 'pending' | 'sheet' | 'native'
  /** Последние точки — для скорости в момент отпускания. */
  samples: { t: number; y: number }[]
}

/** Ближайший вертикально прокручиваемый блок внутри шторки под пальцем. */
function scrollStateAt(target: EventTarget | null, panel: HTMLElement): ScrollState {
  let el = target instanceof Element ? target : null
  while (el && el !== panel) {
    if (el instanceof HTMLElement) {
      const { overflowY } = getComputedStyle(el)
      if (overflowY === 'auto' || overflowY === 'scroll') {
        return { atTop: el.scrollTop <= 0, canScroll: el.scrollHeight > el.clientHeight + 1 }
      }
    }
    el = el.parentElement
  }
  return null
}

/** Текущий сдвиг в px: во время анимации открытия framer хранит его в процентах. */
function currentOffset(value: number | string, panel: HTMLElement): number {
  if (typeof value === 'number') return value
  const n = parseFloat(value)
  if (Number.isNaN(n)) return 0
  return value.endsWith('%') ? (n / 100) * panel.offsetHeight : n
}

function velocityOf(samples: Gesture['samples']): number {
  const last = samples.at(-1)
  const first = samples.find((s) => last && last.t - s.t < 100)
  if (!last || !first || last.t === first.t) return 0
  return ((last.y - first.y) / (last.t - first.t)) * 1000
}

/**
 * Смахивание шторки за любое место, а не только за «ручку»: вертикальный жест
 * вниз забирает шторка, если содержимое прокручено до верха; горизонтальные
 * ленты и обычная прокрутка остаются браузеру. Возвращает смещение шторки
 * и прозрачность затемнения — их подключают в style.
 */
export function useSheetDrag(
  panel: RefObject<HTMLElement | null>,
  onClose: () => void,
): { y: MotionValue<number>; dim: MotionValue<number> } {
  const y = useMotionValue(0)
  const dim = useMotionValue(1)
  const close = useEffectEvent(onClose)

  useEffect(() => {
    const el = panel.current
    if (!el) return
    let g: Gesture | null = null
    let suppressClick = false

    const begin = (x: number, yPos: number, target: EventTarget | null) => {
      g = { startX: x, startY: yPos, scroll: scrollStateAt(target, el), state: 'pending', samples: [] }
    }

    /** true — жест ведёт шторка, событие нужно погасить. */
    const move = (x: number, yPos: number): boolean => {
      if (!g || g.state === 'native') return false
      const dx = x - g.startX
      const dy = yPos - g.startY
      if (g.state === 'pending') {
        g.state = decideDrag(dx, dy, g.scroll)
        if (g.state !== 'sheet') return false
        // Если шторка ещё доезжает после открытия — перехватываем её на месте.
        y.stop()
        g.startY = yPos - currentOffset(y.get(), el)
        window.getSelection()?.removeAllRanges()
        el.style.userSelect = 'none'
      }
      const offset = sheetOffset(yPos - g.startY)
      y.set(offset)
      dim.set(backdropOpacity(offset))
      g.samples.push({ t: performance.now(), y: offset })
      if (g.samples.length > 6) g.samples.shift()
      return true
    }

    const end = () => {
      if (g?.state === 'sheet') {
        suppressClick = true
        el.style.userSelect = ''
        if (shouldClose(y.get(), velocityOf(g.samples))) close()
        else {
          animate(y, 0, softSpring)
          animate(dim, 1, softSpring)
        }
      }
      g = null
    }

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0]
      if (e.touches.length !== 1 || !t) {
        end()
        return
      }
      begin(t.clientX, t.clientY, e.target)
    }
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0]
      if (t && move(t.clientX, t.clientY) && e.cancelable) e.preventDefault()
    }

    const onMouseMove = (e: PointerEvent) => {
      if (move(e.clientX, e.clientY)) e.preventDefault()
    }
    const detachMouse = () => {
      window.removeEventListener('pointermove', onMouseMove)
      window.removeEventListener('pointerup', onMouseUp)
      window.removeEventListener('pointercancel', onMouseUp)
    }
    const onMouseUp = () => {
      detachMouse()
      end()
    }
    const onPointerDown = (e: PointerEvent) => {
      suppressClick = false
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      if (e.target instanceof Element && e.target.closest(MOUSE_IGNORE)) return
      begin(e.clientX, e.clientY, e.target)
      window.addEventListener('pointermove', onMouseMove)
      window.addEventListener('pointerup', onMouseUp)
      window.addEventListener('pointercancel', onMouseUp)
    }
    // После перетаскивания мышью не нажимаем кнопку, на которой его отпустили.
    const onClick = (e: MouseEvent) => {
      if (!suppressClick) return
      suppressClick = false
      e.preventDefault()
      e.stopPropagation()
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('click', onClick, true)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('click', onClick, true)
      detachMouse()
    }
  }, [panel, y, dim])

  return { y, dim }
}
