import { AnimatePresence, LazyMotion, MotionConfig, m } from 'framer-motion'
import { Suspense, lazy, useEffect, type ComponentType } from 'react'
import type { CalendarApi } from './api/api'
import { ApiProvider } from './api/provider'
import { useSyncTimeZone } from './api/queries'
import { useCalendar } from './app/calendar'
import { useNavigation, type Route } from './app/navigation'
import { AppProviders } from './app/providers'
import { SessionGate } from './app/session-gate'
import { BottomBar } from './components/BottomBar'
import { Device } from './components/Device'
import { EventComposer } from './components/EventComposer'
import { VoiceOverlay } from './components/VoiceOverlay'
import { fromISODate, toISODate } from './lib/dates'
import { screenVariants } from './lib/motion'
import { OfflineBadge } from './pwa/OfflineBadge'
import { PushToast } from './pwa/PushToast'
import { UpdatePrompt } from './pwa/UpdatePrompt'
import { useAppBadge } from './pwa/useAppBadge'
import { useLaunchAction } from './pwa/useLaunchAction'
import { usePushEvents } from './pwa/usePushEvents'
import { Day } from './screens/day/Day'
import { Home } from './screens/home/Home'
import { Month } from './screens/month/Month'
import styles from './App.module.css'

// Чанк с возможностями анимаций начинает грузиться сразу при старте, параллельно с первым рендером.
const motionFeatures = import('./lib/motionFeatures').then((r) => r.default)
const loadMotionFeatures = () => motionFeatures

// Чат открывают не сразу — его код (и разметка потока ответа) грузится по первому переходу.
const Chat = lazy(() => import('./screens/chat/Chat').then((mod) => ({ default: mod.Chat })))

const SCREENS: Record<Route, ComponentType> = {
  home: Home,
  month: Month,
  day: Day,
  chat: Chat,
}

/**
 * Синхронизация даты в адресной строке: `#day/2026-10-20` — ссылка на конкретный день.
 * Маршрут пишет NavigationProvider, здесь только доводим хэш до даты и читаем её обратно.
 */
function RouteHashSync() {
  const { route } = useNavigation()
  const { selectedDate, setSelectedDate } = useCalendar()

  useEffect(() => {
    const applyDate = () => {
      const iso = /^#day\/(\d{4}-\d{2}-\d{2})$/.exec(window.location.hash)?.[1]
      if (iso) setSelectedDate(fromISODate(iso))
    }
    applyDate()
    window.addEventListener('popstate', applyDate)
    return () => window.removeEventListener('popstate', applyDate)
  }, [setSelectedDate])

  useEffect(() => {
    if (route === 'day') window.history.replaceState(null, '', `#day/${toISODate(selectedDate)}`)
  }, [route, selectedDate])

  return null
}

function Screens() {
  const { route, dir } = useNavigation()
  useLaunchAction()
  useSyncTimeZone()
  usePushEvents()
  useAppBadge()
  const Screen = SCREENS[route]
  return (
    <AnimatePresence custom={dir}>
      <m.div
        key={route}
        className={styles.layer}
        custom={dir}
        variants={screenVariants}
        initial="enter"
        animate="center"
        exit="exit"
      >
        <Suspense fallback={null}>
          <Screen />
        </Suspense>
      </m.div>
    </AnimatePresence>
  )
}

export function App({ api }: { api: CalendarApi }) {
  return (
    // LazyMotion: компоненты m.* без встроенных возможностей (их грузит loadMotionFeatures); strict ловит забытый motion.*.
    <LazyMotion features={loadMotionFeatures} strict>
      <MotionConfig reducedMotion="user">
        <ApiProvider api={api}>
          <AppProviders>
            <Device>
              <RouteHashSync />
              <SessionGate>
                <Screens />
                <BottomBar />
                <VoiceOverlay />
                <EventComposer />
              </SessionGate>
              <OfflineBadge />
              <UpdatePrompt />
              <PushToast />
            </Device>
          </AppProviders>
        </ApiProvider>
      </MotionConfig>
    </LazyMotion>
  )
}
