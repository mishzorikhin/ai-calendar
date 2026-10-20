/**
 * Чистая логика жеста «смахнуть шторку вниз». Сам жест и анимация — в
 * components/useSheetDrag.ts; здесь только решения, чтобы их можно было протестировать.
 */

/** Сдвиг пальца (px), после которого понятно направление жеста. */
export const AXIS_THRESHOLD = 6
/** Насколько нужно утянуть шторку вниз, чтобы она закрылась. */
export const CLOSE_OFFSET = 110
/** Или с какой скоростью (px/с) её смахнуть. */
export const CLOSE_VELOCITY = 600

/** Состояние прокручиваемого блока под пальцем (null — пальцем взялись не за прокрутку). */
export type ScrollState = { atTop: boolean; canScroll: boolean } | null

export type DragDecision = 'pending' | 'sheet' | 'native'

/**
 * Кто ведёт жест: шторка или браузер (прокрутка содержимого, горизонтальные ленты).
 * Шторка забирает вертикальный жест вниз, если содержимое уже в самом верху,
 * и любой вертикальный жест, если прокручивать нечего.
 */
export function decideDrag(dx: number, dy: number, scroll: ScrollState): DragDecision {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_THRESHOLD) return 'pending'
  if (Math.abs(dx) > Math.abs(dy)) return 'native'
  if (!scroll || !scroll.canScroll) return 'sheet'
  return dy > 0 && scroll.atTop ? 'sheet' : 'native'
}

/** Смещение шторки за пальцем: вниз — один к одному, вверх — с сильным сопротивлением. */
export function sheetOffset(dy: number): number {
  return dy >= 0 ? dy : dy * 0.05
}

export function shouldClose(offset: number, velocity: number): boolean {
  return offset > CLOSE_OFFSET || velocity > CLOSE_VELOCITY
}

/** Затемнение фона по мере того, как шторку тянут вниз: от 1 до 0,35. */
export function backdropOpacity(offset: number): number {
  return Math.max(0.35, 1 - Math.max(0, offset) / 500)
}
