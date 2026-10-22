import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useTimeout } from '../../lib/hooks'
import { dragResult, DRAG_STEP, isDraggable, type DragMode } from '../../domain/drag'
import type { CalendarEvent } from '../../domain/types'

/** Сколько держать палец, чтобы поднять карточку, мс. */
const LIFT_DELAY = 300
/** Сдвиг пальца до подъёма, после которого это уже прокрутка, px. */
const SLOP = 8
/** Нижняя полоса карточки, за которую меняют длительность, px. */
const RESIZE_ZONE = 14

type Drag = { mode: DragMode; startY: number; dy: number; lifted: boolean; pointerId: number }

/**
 * Перетаскивание карточки на шкале: долгое нажатие поднимает её, дальше палец двигает время
 * (за нижний край — длительность). Пока карточка поднята, шкала не прокручивается.
 * С клавиатуры — Alt+↑/↓ (сдвиг на 15 минут), Alt+Shift+↑/↓ — длительность.
 */
export function useEventDrag(
  event: CalendarEvent,
  bounds: { from: number; to: number },
  hourPx: number,
  onMove: ((event: CalendarEvent, next: { start: number; end: number }) => void) | undefined,
) {
  const enabled = !!onMove && isDraggable(event)
  const [drag, setDrag] = useState<Drag | null>(null)
  const ref = useRef<HTMLButtonElement>(null)
  const lifted = useRef(false)
  // Клик после перетаскивания не открывает событие.
  const suppressClick = useRef(false)

  // Палец держат на месте LIFT_DELAY — карточка поднимается.
  useTimeout(
    () => {
      if (!drag) return
      lifted.current = true
      ref.current?.setPointerCapture(drag.pointerId)
      navigator.vibrate?.(10)
      setDrag({ ...drag, lifted: true })
    },
    drag && !drag.lifted ? LIFT_DELAY : null,
    drag?.startY,
  )

  // Пока карточка поднята, браузер не должен прокручивать шкалу (слушатель обязан быть не пассивным).
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const block = (e: TouchEvent) => {
      if (lifted.current) e.preventDefault()
    }
    el.addEventListener('touchmove', block, { passive: false })
    return () => el.removeEventListener('touchmove', block)
  }, [enabled])

  const reset = () => {
    lifted.current = false
    setDrag(null)
  }

  const preview = drag?.lifted ? dragResult(event.start, event.end, drag.dy, drag.mode, bounds, hourPx) : null

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (!enabled || e.button !== 0) return
    // После касания с движением браузер клик не шлёт — старую отметку снимаем здесь.
    suppressClick.current = false
    const rect = e.currentTarget.getBoundingClientRect()
    const mode: DragMode = rect.bottom - e.clientY <= RESIZE_ZONE ? 'resize' : 'move'
    setDrag({ mode, startY: e.clientY, dy: 0, lifted: false, pointerId: e.pointerId })
  }

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return
    const dy = e.clientY - drag.startY
    if (!drag.lifted) {
      if (Math.abs(dy) > SLOP) reset()
      return
    }
    setDrag({ ...drag, dy })
  }

  const onPointerUp = () => {
    if (preview && onMove) {
      suppressClick.current = true
      onMove(event, preview)
    }
    reset()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!enabled || !onMove || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    const dy = ((e.key === 'ArrowUp' ? -3 : 3) * DRAG_STEP * hourPx) / 60
    onMove(event, dragResult(event.start, event.end, dy, e.shiftKey ? 'resize' : 'move', bounds, hourPx))
  }

  /** true — клик съеден перетаскиванием. */
  const consumeClick = () => {
    const was = suppressClick.current
    suppressClick.current = false
    return was
  }

  return {
    enabled,
    ref,
    preview,
    mode: drag?.lifted ? drag.mode : null,
    consumeClick,
    handlers: enabled
      ? {
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel: reset,
          onKeyDown,
          onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
        }
      : {},
  }
}
