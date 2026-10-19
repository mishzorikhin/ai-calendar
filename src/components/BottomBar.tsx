import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { useApp } from '../app/store'
import { softSpring, spring } from '../lib/motion'
import { InfinityIcon, PlusIcon } from './Icons'
import { CircleButton, Pressable, Waveform } from './ui'
import styles from './BottomBar.module.css'

/** Нижняя панель на градиенте: «∞» — ассистент, «+» — создать, в центре — контекст экрана. */
export function BottomBar() {
  const { bar, go, voice, setVoice } = useApp()
  const centerKey = voice ? 'voice' : bar.key

  return (
    <motion.nav
      className={styles.bar}
      initial={false}
      animate={{ y: bar.hidden ? '120%' : '0%', opacity: bar.hidden ? 0 : 1 }}
      transition={softSpring}
      aria-label="Панель действий"
    >
      <CircleButton
        tone="pink"
        size={48}
        aria-label="Ассистент"
        onClick={bar.onAi ?? (() => go('chat'))}
        className={bar.aiActive || voice ? styles.aiActive : undefined}
      >
        <InfinityIcon size={22} />
      </CircleButton>

      <div className={styles.center}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={centerKey}
            className={styles.centerInner}
            initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -12, filter: 'blur(6px)' }}
            transition={spring}
          >
            {voice ? (
              <Pressable className={styles.voice} onClick={() => setVoice(false)} aria-label="Остановить запись">
                <Waveform bars={22} color="rgba(60, 40, 70, 0.7)" height={24} />
              </Pressable>
            ) : (
              bar.center
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <CircleButton tone="glass" size={48} aria-label="Создать" onClick={bar.onPlus ?? (() => go('chat'))}>
        <PlusIcon size={22} />
      </CircleButton>
    </motion.nav>
  )
}

/** Подсказка «Нажмите и говорите» — запускает голосовой ввод. */
export function TapToSay() {
  const { setVoice } = useApp()
  return (
    <Pressable className={styles.say} onClick={() => setVoice(true)} scale={0.97}>
      Нажмите и говорите
    </Pressable>
  )
}

export function BarText({ children }: { children: ReactNode }) {
  return <span className={styles.text}>{children}</span>
}

export function BarChips({ children }: { children: ReactNode }) {
  return (
    <motion.div className={`${styles.chips} scroll-x`} layout transition={spring}>
      {children}
    </motion.div>
  )
}
