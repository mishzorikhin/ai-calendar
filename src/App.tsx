import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { AppProvider, useApp, type Route } from './app/store'
import { BottomBar } from './components/BottomBar'
import { Device } from './components/Device'
import { VoiceOverlay } from './components/VoiceOverlay'
import { screenVariants } from './lib/motion'
import { Agent } from './screens/Agent'
import { Chat } from './screens/Chat'
import { Day } from './screens/Day'
import { Home } from './screens/Home'
import { Month } from './screens/Month'
import styles from './App.module.css'

const SCREENS: Record<Route, () => React.JSX.Element> = {
  home: Home,
  month: Month,
  day: Day,
  chat: Chat,
  agent: Agent,
}

function Screens() {
  const { route, dir } = useApp()
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
      <AppProvider>
        <Device>
          <Screens />
          <BottomBar />
          <VoiceOverlay />
        </Device>
      </AppProvider>
    </MotionConfig>
  )
}
