/** Шаг, к которому прилипает время при перетаскивании, минут. */
export const DRAG_STEP = 5
/** Самое короткое событие после изменения длительности, минут. */
export const DRAG_MIN = 15

export type DragMode = 'move' | 'resize'

/**
 * Время события после перетаскивания на dy пикселей шкалы (hourPx — высота часа).
 * move — сдвиг целиком, resize — только конец. Шаг — DRAG_STEP минут; событие не выходит
 * за границы [from, to] (часть суток) и не короче DRAG_MIN.
 */
export function dragResult(
  start: number,
  end: number,
  dy: number,
  mode: DragMode,
  bounds: { from: number; to: number },
  hourPx: number,
): { start: number; end: number } {
  const delta = Math.round((dy / hourPx) * (60 / DRAG_STEP)) * DRAG_STEP
  if (mode === 'resize') {
    const next = Math.min(Math.max(end + delta, start + DRAG_MIN), Math.max(bounds.to, end))
    return { start, end: next }
  }
  const length = end - start
  const nextStart = Math.min(Math.max(start + delta, bounds.from), Math.max(bounds.to - length, bounds.from))
  return { start: nextStart, end: nextStart + length }
}

/** Можно ли таскать событие: своё, со временем, однодневное. */
export const isDraggable = (e: {
  readOnly?: boolean
  allDay?: boolean
  invite?: unknown
  span?: unknown
  endDate?: string
}) => !e.readOnly && !e.allDay && !e.invite && !e.span && !e.endDate
