import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEMO_PROMPT, type Booking } from '../data'
import { startOfDay } from '../lib/dates'

export type Route = 'home' | 'month' | 'day' | 'chat' | 'agent'

export type BarConfig = {
  /** Смена ключа анимирует содержимое центра панели. */
  key: string
  center?: ReactNode
  hidden?: boolean
  onAi?: () => void
  onPlus?: () => void
  aiActive?: boolean
}

type AppState = {
  route: Route
  dir: 1 | -1
  go: (route: Route) => void
  back: () => void
  reset: (route: Route) => void
  prompt: string
  setPrompt: (p: string) => void
  booking: Booking | null
  setBooking: (b: Booking | null) => void
  selectedDate: Date
  setSelectedDate: (d: Date) => void
  bar: BarConfig
  setBar: (b: BarConfig) => void
  voice: boolean
  setVoice: (v: boolean) => void
}

const AppContext = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>(['home'])
  const [dir, setDir] = useState<1 | -1>(1)
  const [prompt, setPrompt] = useState(DEMO_PROMPT)
  const [booking, setBooking] = useState<Booking | null>(null)
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()))
  const [bar, setBar] = useState<BarConfig>({ key: 'init' })
  const [voice, setVoice] = useState(false)

  const go = useCallback((route: Route) => {
    setDir(1)
    setStack((s) => (s[s.length - 1] === route ? s : [...s, route]))
  }, [])

  const back = useCallback(() => {
    setDir(-1)
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
  }, [])

  const reset = useCallback((route: Route) => {
    setDir(-1)
    setStack(route === 'home' ? ['home'] : ['home', route])
  }, [])

  const value = useMemo<AppState>(
    () => ({
      route: stack[stack.length - 1],
      dir,
      go,
      back,
      reset,
      prompt,
      setPrompt,
      booking,
      setBooking,
      selectedDate,
      setSelectedDate,
      bar,
      setBar,
      voice,
      setVoice,
    }),
    [stack, dir, go, back, reset, prompt, booking, selectedDate, bar, voice],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp вне AppProvider')
  return ctx
}

/** Экран сообщает нижней панели, что в ней показывать. */
export function useBar(config: BarConfig, deps: unknown[]) {
  const { setBar } = useApp()
  useEffect(() => {
    setBar(config)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
