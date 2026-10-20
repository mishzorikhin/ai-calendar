import { useEffect, useEffectEvent, useRef, useState, type MouseEvent } from 'react'

/** Высота экранной клавиатуры (iOS накрывает ею страницу, а не сжимает её). */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return inset
}

/**
 * Вызывает колбэк через `delay` мс. `null` — таймер не запущен.
 * Смена `delay` или `resetKey` перезапускает отсчёт; при размонтировании таймер снимается.
 */
export function useTimeout(callback: () => void, delay: number | null, resetKey?: unknown) {
  const onTimeout = useEffectEvent(callback)
  useEffect(() => {
    if (delay === null) return
    const id = window.setTimeout(() => onTimeout(), delay)
    return () => window.clearTimeout(id)
  }, [delay, resetKey])
}

/** Вызывает колбэк каждые `delay` мс. `null` — пауза. */
export function useInterval(callback: () => void, delay: number | null) {
  const onTick = useEffectEvent(callback)
  useEffect(() => {
    if (delay === null) return
    const id = window.setInterval(() => onTick(), delay)
    return () => window.clearInterval(id)
  }, [delay])
}

/** Текущее время, обновляется раз в `step` мс — для линии «сейчас» и «Далее». */
export function useNow(step = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useInterval(() => setNow(new Date()), step)
  return now
}

/** Минуты от полуночи. */
export function minutesOf(d: Date): number {
  return d.getHours() * 60 + d.getMinutes()
}

/**
 * Гасит «клик» в конце перетаскивания мышью: свайп недели или месяца
 * не должен заодно выбирать день, на котором отпустили кнопку.
 * Пропсы вешаются на тот же motion-элемент, у которого `drag`.
 */
export function useDragClickGuard() {
  const dragged = useRef(false)
  return {
    onPointerDownCapture: () => {
      dragged.current = false
    },
    onDragStart: () => {
      dragged.current = true
    },
    onClickCapture: (e: MouseEvent) => {
      if (!dragged.current) return
      dragged.current = false
      e.preventDefault()
      e.stopPropagation()
    },
  }
}
