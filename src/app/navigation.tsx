import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react'

export type Route = 'home' | 'month' | 'day' | 'chat' | 'agent'

type Navigation = {
  route: Route
  /** Направление последнего перехода: вперёд — 1, назад — −1 (для анимации экранов). */
  dir: 1 | -1
  go: (route: Route) => void
  back: () => void
  /** Сбросить стек: главная или главная → `route`. */
  reset: (route: Route) => void
}

const NavigationContext = createContext<Navigation | null>(null)

type NavState = { stack: readonly [Route, ...Route[]]; dir: 1 | -1 }

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NavState>({ stack: ['home'], dir: 1 })

  const go = useCallback((route: Route) => {
    setState((s) => (s.stack.at(-1) === route ? s : { stack: [...s.stack, route], dir: 1 }))
  }, [])

  const back = useCallback(() => {
    setState((s) => {
      const [first, ...rest] = s.stack
      return rest.length ? { stack: [first, ...rest.slice(0, -1)], dir: -1 } : s
    })
  }, [])

  const reset = useCallback((route: Route) => {
    setState({ stack: route === 'home' ? ['home'] : ['home', route], dir: -1 })
  }, [])

  const value = useMemo<Navigation>(
    () => ({ route: state.stack.at(-1) ?? 'home', dir: state.dir, go, back, reset }),
    [state, go, back, reset],
  )
  return <NavigationContext value={value}>{children}</NavigationContext>
}

export function useNavigation(): Navigation {
  const ctx = use(NavigationContext)
  if (!ctx) throw new Error('useNavigation вне NavigationProvider')
  return ctx
}
