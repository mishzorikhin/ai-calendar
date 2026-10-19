import { useEffect, useRef, useState } from 'react'

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

/** Секундомер, который можно остановить. */
export function useTicker(running: boolean, intervalMs = 1000): number {
  const [ticks, setTicks] = useState(0)
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setTicks((t) => t + 1), intervalMs)
    return () => window.clearInterval(id)
  }, [running, intervalMs])
  return ticks
}

/** Вызывает колбэк через delay мс, пока условие истинно. */
export function useTimeout(cb: () => void, delay: number | null) {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => {
    if (delay === null) return
    const id = window.setTimeout(() => ref.current(), delay)
    return () => window.clearTimeout(id)
  }, [delay])
}
