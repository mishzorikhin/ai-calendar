import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react'
import { spanOrigin } from '../domain/span'
import type { DatedEvent } from '../domain/types'
import { fromISODate, startOfDay } from '../lib/dates'

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
    // День многодневного события открывает событие целиком: с первого дня и исходным временем.
    const event = opts?.event && spanOrigin(opts.event, fromISODate)
    setRequest({
      date: startOfDay(event?.date ?? opts?.date ?? new Date()),
      start: event?.start ?? opts?.start ?? null,
      event,
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
