import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Route = 'home' | 'month' | 'day' | 'chat'

const ROUTES: readonly Route[] = ['home', 'month', 'day', 'chat']

/** Маршрут из хэша адреса: `#day`, `#day/2026-10-20`, `#chat`… */
function routeFromHash(hash: string): Route | null {
  const name = /^#([a-z]+)/.exec(hash)?.[1]
  return ROUTES.find((r) => r === name) ?? null
}

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

type NavState = {
  stack: readonly [Route, ...Route[]]
  dir: 1 | -1
  /** Кто изменил стек: 'user' — записываем в историю, 'pop' — пришло из истории, писать не надо. */
  sync: 'user' | 'pop'
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NavState>(() => {
    const deep = routeFromHash(window.location.hash)
    return { stack: deep && deep !== 'home' ? ['home', deep] : ['home'], dir: 1, sync: 'pop' }
  })

  const go = useCallback((route: Route) => {
    setState((s) => (s.stack.at(-1) === route ? s : { stack: [...s.stack, route], dir: 1, sync: 'user' }))
  }, [])

  const back = useCallback(() => {
    setState((s) => {
      const [first, ...rest] = s.stack
      return rest.length ? { stack: [first, ...rest.slice(0, -1)], dir: -1, sync: 'user' } : s
    })
  }, [])

  const reset = useCallback((route: Route) => {
    setState({ stack: route === 'home' ? ['home'] : ['home', route], dir: -1, sync: 'user' })
  }, [])

  // Верхний маршрут живёт в адресной строке: страницу можно перезагрузить, запинить или переслать.
  useEffect(() => {
    if (state.sync === 'pop') return
    const top = state.stack.at(-1) ?? 'home'
    const target = `#${top}`
    if (!window.location.hash.startsWith(target)) {
      window.history.pushState(null, '', target)
    }
  }, [state])

  // Кнопка «назад» браузера: маршрут из хэша становится верхом стека (главная всегда под ним).
  useEffect(() => {
    const onPop = () => {
      const route = routeFromHash(window.location.hash) ?? 'home'
      setState((s) =>
        s.stack.at(-1) === route && s.stack.length === (route === 'home' ? 1 : 2)
          ? s
          : { stack: route === 'home' ? ['home'] : ['home', route], dir: -1, sync: 'pop' },
      )
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
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
