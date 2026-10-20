import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react'
import type { DatedEvent } from '../domain/types'
import { startOfDay } from '../lib/dates'

/**
 * Открытая шторка события: без `event` — создание на дату и время
 * (null — подобрать ближайшее свободное), с `event` — редактирование.
 */
export type ComposerRequest = { date: Date; start: number | null; event?: DatedEvent }

type Composer = {
  request: ComposerRequest | null
  open: (opts?: { date?: Date; start?: number; event?: DatedEvent }) => void
  close: () => void
}

const ComposerContext = createContext<Composer | null>(null)

export function ComposerProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ComposerRequest | null>(null)

  const open = useCallback((opts?: { date?: Date; start?: number; event?: DatedEvent }) => {
    setRequest({
      date: startOfDay(opts?.event?.date ?? opts?.date ?? new Date()),
      start: opts?.event?.start ?? opts?.start ?? null,
      event: opts?.event,
    })
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
