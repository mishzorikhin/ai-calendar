import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import type { ComponentType } from 'react'
import { useNavigation, type Route } from './app/navigation'
import { AppProviders } from './app/providers'
import { BottomBar } from './components/BottomBar'
import { Device } from './components/Device'
import { EventComposer } from './components/EventComposer'
import { VoiceOverlay } from './components/VoiceOverlay'
import { screenVariants } from './lib/motion'
import { Agent } from './screens/agent/Agent'
import { Chat } from './screens/chat/Chat'
import { Day } from './screens/day/Day'
import { Home } from './screens/home/Home'
import { Month } from './screens/month/Month'
import styles from './App.module.css'

const SCREENS: Record<Route, ComponentType> = {
  home: Home,
  month: Month,
  day: Day,
  chat: Chat,
  agent: Agent,
}

function Screens() {
  const { route, dir } = useNavigation()
  const Screen = SCREENS[route]
  return (
    <AnimatePresence custom={dir}>
      <motion.div
        key={route}
        className={styles.layer}
        custom={dir}
        variants={screenVariants}
        initial="enter"
        animate="center"
        exit="exit"
      >
        <Screen />
      </motion.div>
    </AnimatePresence>
  )
}

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AppProviders>
        <Device>
          <Screens />
          <BottomBar />
          <VoiceOverlay />
          <EventComposer />
        </Device>
      </AppProviders>
    </MotionConfig>
  )
}
