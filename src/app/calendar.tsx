import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react'
import { startOfDay } from '../lib/dates'

/** Состояние интерфейса календаря. Сами данные (события, брони) — в api/queries. */
type Calendar = {
  /** Выбранный день, всегда начало суток. */
  selectedDate: Date
  setSelectedDate: (d: Date) => void
}

const CalendarContext = createContext<Calendar | null>(null)

export function CalendarProvider({ children }: { children: ReactNode }) {
  const [selectedDate, setSelected] = useState(() => startOfDay(new Date()))
  const setSelectedDate = useCallback((d: Date) => setSelected(startOfDay(d)), [])
  const value = useMemo<Calendar>(() => ({ selectedDate, setSelectedDate }), [selectedDate, setSelectedDate])
  return <CalendarContext value={value}>{children}</CalendarContext>
}

export function useCalendar(): Calendar {
  const ctx = use(CalendarContext)
  if (!ctx) throw new Error('useCalendar вне CalendarProvider')
  return ctx
}
