import { AnimatePresence, motion } from 'framer-motion'
import { useState, type ReactNode } from 'react'
import { useApp } from '../app/store'
import { softSpring, spring } from '../lib/motion'
import { InfinityIcon, PlusIcon } from './Icons'
import { CircleButton, Pressable, Waveform } from './ui'
import styles from './BottomBar.module.css'

/** Нижняя панель на градиенте: «∞» — ассистент, «+» — создать, в центре — контекст экрана. */
export function BottomBar() {
  const { bar, go, voice, setVoice, openComposer, route } = useApp()
  const centerKey = voice === true ? 'voice' : voice === 'review' ? 'voice-review' : bar.key
  const [hint, setHint] = useState(() => !readFlag(HINT_KEY))

  const dismissHint = () => {
    setHint(false)
    writeFlag(HINT_KEY)
  }

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
        onClick={() => {
          dismissHint()
          ;(bar.onAi ?? (() => go('chat')))()
        }}
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
            {voice === 'review' ? (
              <span className={styles.text}>Проверьте текст запроса</span>
            ) : voice ? (
              <Pressable className={styles.voice} onClick={() => setVoice(false)} aria-label="Остановить запись">
                <Waveform bars={22} color="rgba(60, 40, 70, 0.7)" height={24} />
              </Pressable>
            ) : (
              bar.center
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <CircleButton tone="glass" size={48} aria-label="Новое событие" onClick={bar.onPlus ?? (() => openComposer())}>
        <PlusIcon size={22} />
      </CircleButton>

      <AnimatePresence>
        {hint && route === 'home' && !bar.hidden && !voice && (
          <motion.div
            className={styles.hint}
            role="status"
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.95 }}
            transition={{ ...spring, delay: 0.8 }}
          >
            <b>Это ваш ассистент</b>
            Скажите или напишите, что нужно запланировать: он найдёт время, место и забронирует.
            <Pressable className={styles.hintBtn} onClick={dismissHint}>
              Понятно
            </Pressable>
          </motion.div>
        )}
      </AnimatePresence>
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

const HINT_KEY = 'ai-calendar:hint-assistant'

// Хранилище может быть недоступно (приватный режим) — тогда подсказка просто покажется снова.
function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeFlag(key: string) {
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    /* ничего страшного */
  }
}
