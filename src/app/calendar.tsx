import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react'
import type { Booking, DatedEvent } from '../domain/types'
import { startOfDay } from '../lib/dates'

type Calendar = {
  /** Выбранный день, всегда начало суток. */
  selectedDate: Date
  setSelectedDate: (d: Date) => void
  booking: Booking | null
  setBooking: (b: Booking | null) => void
  customEvents: readonly DatedEvent[]
  addEvent: (e: DatedEvent) => void
}

const CalendarContext = createContext<Calendar | null>(null)

export function CalendarProvider({ children }: { children: ReactNode }) {
  const [selectedDate, setSelected] = useState(() => startOfDay(new Date()))
  const [booking, setBooking] = useState<Booking | null>(null)
  const [customEvents, setCustomEvents] = useState<readonly DatedEvent[]>([])

  const setSelectedDate = useCallback((d: Date) => setSelected(startOfDay(d)), [])
  const addEvent = useCallback((e: DatedEvent) => setCustomEvents((list) => [...list, e]), [])

  const value = useMemo<Calendar>(
    () => ({ selectedDate, setSelectedDate, booking, setBooking, customEvents, addEvent }),
    [selectedDate, setSelectedDate, booking, customEvents, addEvent],
  )
  return <CalendarContext value={value}>{children}</CalendarContext>
}

export function useCalendar(): Calendar {
  const ctx = use(CalendarContext)
  if (!ctx) throw new Error('useCalendar вне CalendarProvider')
  return ctx
}
