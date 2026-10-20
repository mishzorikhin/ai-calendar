import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEMO_PROMPT, type Booking, type ChatMessage, type DatedEvent } from '../data'
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
  /** true — идёт запись, 'review' — текст распознан и ждёт проверки. */
  voice: boolean | 'review'
  setVoice: (v: boolean | 'review') => void
  /** Текст, который откроется в поле чата (например, чтобы поправить запрос). */
  draft: string
  setDraft: (t: string) => void
  messages: ChatMessage[]
  addMessage: (role: ChatMessage['role'], text: string) => void
  customEvents: DatedEvent[]
  addEvent: (e: DatedEvent) => void
  /** Шторка создания события: на какую дату и время. */
  composer: { date: Date; start: number | null } | null
  openComposer: (opts?: { date?: Date; start?: number }) => void
  closeComposer: () => void
}

const AppContext = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>(['home'])
  const [dir, setDir] = useState<1 | -1>(1)
  const [prompt, setPrompt] = useState(DEMO_PROMPT)
  const [booking, setBooking] = useState<Booking | null>(null)
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()))
  const [bar, setBar] = useState<BarConfig>({ key: 'init' })
  const [voice, setVoice] = useState<boolean | 'review'>(false)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: 0, role: 'ai', text: 'Чем могу помочь?' }])
  const [customEvents, setCustomEvents] = useState<DatedEvent[]>([])
  const [composer, setComposer] = useState<AppState['composer']>(null)

  const addMessage = useCallback((role: ChatMessage['role'], text: string) => {
    setMessages((m) => [...m, { id: m.length, role, text }])
  }, [])

  const addEvent = useCallback((e: DatedEvent) => setCustomEvents((list) => [...list, e]), [])

  const openComposer = useCallback((opts?: { date?: Date; start?: number }) => {
    // Без явного времени шторка сама подберёт ближайшее свободное.
    setComposer({ date: opts?.date ?? startOfDay(new Date()), start: opts?.start ?? null })
  }, [])

  const closeComposer = useCallback(() => setComposer(null), [])

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
      draft,
      setDraft,
      messages,
      addMessage,
      customEvents,
      addEvent,
      composer,
      openComposer,
      closeComposer,
    }),
    [
      stack,
      dir,
      go,
      back,
      reset,
      prompt,
      booking,
      selectedDate,
      bar,
      voice,
      draft,
      messages,
      addMessage,
      customEvents,
      addEvent,
      composer,
      openComposer,
      closeComposer,
    ],
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
