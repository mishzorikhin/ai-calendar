import { AnimatePresence, m } from 'framer-motion'
import { useState, type ReactNode } from 'react'
import { useAssistant } from '../app/assistant'
import { useBarContext } from '../app/bar'
import { useComposer } from '../app/composer'
import { useNavigation } from '../app/navigation'
import { softSpring, spring } from '../lib/motion'
import { speechSupported } from '../lib/speech'
import { readFlag, writeFlag } from '../lib/storage'
import { InfinityIcon, PlusIcon } from './Icons'
import { CircleButton, Pressable, Waveform } from './ui'
import styles from './BottomBar.module.css'

const HINT_KEY = 'ai-calendar:hint-assistant'

/**
 * Нижняя панель на градиенте: «∞» — ассистент, «+» — новое событие.
 * Центр заполняет активный экран через `<BarSlot>`.
 */
export function BottomBar() {
  const { state, setSlot } = useBarContext()
  const { go, route } = useNavigation()
  const { voice, setVoice } = useAssistant()
  const composer = useComposer()
  const [hint, setHint] = useState(() => !readFlag(HINT_KEY))
  const voiceActive = voice !== 'idle'

  const dismissHint = () => {
    setHint(false)
    writeFlag(HINT_KEY)
  }

  return (
    <m.nav
      className={styles.bar}
      initial={false}
      animate={{ y: state.hidden ? '120%' : '0%', opacity: state.hidden ? 0 : 1 }}
      transition={softSpring}
      aria-label="Панель действий"
      aria-hidden={state.hidden}
      inert={state.hidden}
      onPointerDown={hint ? dismissHint : undefined}
    >
      <span className={styles.side}>
        <CircleButton
          tone="pink"
          size={48}
          aria-label="Ассистент"
          onClick={() => {
            dismissHint()
            go('chat')
          }}
          className={state.aiActive || voiceActive ? styles.aiActive : undefined}
        >
          <InfinityIcon size={22} />
        </CircleButton>
        <span className={styles.sideLabel}>Ассистент</span>
      </span>

      <div className={styles.center}>
        <div ref={setSlot} className={styles.slot} hidden={voiceActive} />
        <AnimatePresence initial={false}>
          {voiceActive && (
            <m.div
              key={voice}
              className={styles.centerInner}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={spring}
            >
              {voice === 'review' ? (
                <span className={styles.text}>Проверьте текст запроса</span>
              ) : (
                <Pressable className={styles.voice} onClick={() => setVoice('review')} aria-label="Закончить диктовку">
                  <Waveform bars={22} color="var(--bar-ink-2)" height={24} />
                </Pressable>
              )}
            </m.div>
          )}
        </AnimatePresence>
      </div>

      <span className={styles.side}>
        <CircleButton tone="glass" size={48} aria-label="Новое событие" onClick={() => composer.open()}>
          <PlusIcon size={22} />
        </CircleButton>
        <span className={styles.sideLabel}>Событие</span>
      </span>

      <AnimatePresence>
        {hint && route === 'home' && !state.hidden && !voiceActive && (
          <m.div
            className={styles.hint}
            role="status"
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.95 }}
            transition={{ ...spring, delay: 0.8 }}
          >
            <b>Это ваш ассистент</b>
            Скажите или напишите, что нужно запланировать — он найдёт свободное время и добавит событие.
            <Pressable className={styles.hintBtn} onClick={dismissHint}>
              Понятно
            </Pressable>
          </m.div>
        )}
      </AnimatePresence>
    </m.nav>
  )
}

/** «Нажмите и говорите» — запускает голосовой ввод; скрыто там, где браузер не умеет распознавать речь. */
export function TapToSay() {
  const { setVoice } = useAssistant()
  if (!speechSupported) return null
  return (
    <Pressable className={styles.say} onClick={() => setVoice('recording')} scale={0.97}>
      Нажмите и говорите
    </Pressable>
  )
}

export function BarText({ children }: { children: ReactNode }) {
  return <span className={styles.text}>{children}</span>
}

export function BarChips({ children }: { children: ReactNode }) {
  return <div className={`${styles.chips} scroll-x`}>{children}</div>
}
