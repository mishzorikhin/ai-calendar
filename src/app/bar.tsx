import { AnimatePresence, m, useIsPresent } from 'framer-motion'
import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { spring } from '../lib/motion'

/** Состояние нижней панели, которое задаёт активный экран. */
export type BarState = { hidden: boolean; aiActive: boolean }

type Bar = {
  state: BarState
  setState: (s: BarState) => void
  /** Узел в центре панели, куда экраны рендерят своё содержимое через портал. */
  slot: HTMLElement | null
  setSlot: (el: HTMLElement | null) => void
}

const BarContext = createContext<Bar | null>(null)

export function BarProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BarState>({ hidden: false, aiActive: false })
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const value = useMemo<Bar>(() => ({ state, setState, slot, setSlot }), [state, slot])
  return <BarContext value={value}>{children}</BarContext>
}

export function useBarContext(): Bar {
  const ctx = use(BarContext)
  if (!ctx) throw new Error('useBarContext вне BarProvider')
  return ctx
}

/**
 * Содержимое центра нижней панели. Рендерится в дереве экрана (обычные пропсы и замыкания,
 * без ручных зависимостей), а показывается в панели через портал.
 * Смена `id` анимирует переход; уходящий экран плавно убирает своё содержимое.
 */
export function BarSlot({
  id,
  hidden = false,
  aiActive = false,
  children,
}: {
  id: string
  hidden?: boolean
  aiActive?: boolean
  children?: ReactNode
}) {
  const { slot, setState } = useBarContext()
  const isPresent = useIsPresent()

  useEffect(() => {
    if (isPresent) setState({ hidden, aiActive })
  }, [isPresent, hidden, aiActive, setState])

  if (!slot) return null
  return createPortal(
    <AnimatePresence mode="popLayout">
      {isPresent && !hidden && children && (
        <m.div
          key={id}
          className="bar-slot-item"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={spring}
        >
          {children}
        </m.div>
      )}
    </AnimatePresence>,
    slot,
  )
}
