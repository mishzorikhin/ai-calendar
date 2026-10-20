import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react'
import { startOfDay } from '../lib/dates'

/** Открытая шторка создания события: дата и время (null — подобрать ближайшее свободное). */
export type ComposerRequest = { date: Date; start: number | null }

type Composer = {
  request: ComposerRequest | null
  open: (opts?: { date?: Date; start?: number }) => void
  close: () => void
}

const ComposerContext = createContext<Composer | null>(null)

export function ComposerProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ComposerRequest | null>(null)

  const open = useCallback((opts?: { date?: Date; start?: number }) => {
    setRequest({ date: startOfDay(opts?.date ?? new Date()), start: opts?.start ?? null })
  }, [])
  const close = useCallback(() => setRequest(null), [])

  const value = useMemo<Composer>(() => ({ request, open, close }), [request, open, close])
  return <ComposerContext value={value}>{children}</ComposerContext>
}

export function useComposer(): Composer {
  const ctx = use(ComposerContext)
  if (!ctx) throw new Error('useComposer вне ComposerProvider')
  return ctx
}
