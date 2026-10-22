import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react'

/** Действие, которое можно отменить: подпись на плашке и как вернуть всё назад. */
export type UndoItem = { id: number; text: string; undo: () => void }

type Undo = {
  item: UndoItem | null
  /** Показать плашку «Отменить» (новая заменяет прежнюю). */
  offer: (text: string, undo: () => void) => void
  dismiss: () => void
}

const UndoContext = createContext<Undo | null>(null)

export function UndoProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<UndoItem | null>(null)
  const offer = useCallback((text: string, undo: () => void) => {
    setItem((prev) => ({ id: (prev?.id ?? 0) + 1, text, undo }))
  }, [])
  const dismiss = useCallback(() => setItem(null), [])
  const value = useMemo<Undo>(() => ({ item, offer, dismiss }), [item, offer, dismiss])
  return <UndoContext value={value}>{children}</UndoContext>
}

export function useUndo(): Undo {
  const ctx = use(UndoContext)
  if (!ctx) throw new Error('useUndo вне UndoProvider')
  return ctx
}
