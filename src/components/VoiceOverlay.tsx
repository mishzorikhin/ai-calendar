import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useState } from 'react'
import { useAssistant } from '../app/assistant'
import { useNavigation } from '../app/navigation'
import { useTimeout } from '../lib/hooks'
import { softSpring, spring } from '../lib/motion'
import { DEMO_PROMPT } from '../mocks/assistant'
import { Pill } from './ui'
import styles from './VoiceOverlay.module.css'

const WORDS = DEMO_PROMPT.split(' ')
const FIRST_WORD_MS = 650

/**
 * Голосовой ввод: слова «распознаются» по одному.
 * Запрос не уходит сам — пользователь проверяет текст и отправляет или исправляет его.
 */
export function VoiceOverlay() {
  const { voice, setVoice, setPrompt, setDraft, addMessage } = useAssistant()
  const { route, go } = useNavigation()
  const visible = voice !== 'idle' && route !== 'chat' && route !== 'agent'

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="voice"
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
          onClick={() => setVoice('idle')}
        >
          <Listening
            onRecognized={() => setVoice('review')}
            onSend={(text) => {
              setPrompt(text)
              addMessage('user', text)
              setVoice('idle')
              go('agent')
            }}
            onEdit={(text) => {
              setDraft(text)
              setVoice('idle')
              go('chat')
            }}
            onCancel={() => setVoice('idle')}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Listening({
  onRecognized,
  onSend,
  onEdit,
  onCancel,
}: {
  onRecognized: () => void
  onSend: (text: string) => void
  onEdit: (text: string) => void
  onCancel: () => void
}) {
  const [count, setCount] = useState(0)
  const done = count >= WORDS.length
  const still = useReducedMotion()

  useTimeout(
    () => {
      const next = count + 1
      setCount(next)
      if (next >= WORDS.length) onRecognized()
    },
    done ? null : count === 0 ? FIRST_WORD_MS : 120 + (count % 3) * 30,
    count,
  )

  return (
    <motion.div
      className={styles.panel}
      role="dialog"
      aria-label="Голосовой ввод"
      initial={{ y: 40, opacity: 0, scale: 0.96 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: 30, opacity: 0 }}
      transition={softSpring}
      onClick={(e) => e.stopPropagation()}
    >
      <span className={styles.label} aria-live="polite">
        {!done && (
          <motion.i
            animate={still ? undefined : { scale: [1, 1.5, 1], opacity: [1, 0.4, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
        )}
        {count === 0 ? 'Слушаю…' : done ? 'Проверьте, правильно ли я понял' : 'Распознаю речь'}
      </span>
      <p className={styles.text}>
        {WORDS.slice(0, count).map((w, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {w}{' '}
          </motion.span>
        ))}
        {count === 0 && <span className={styles.placeholder}>Скажите, что нужно запланировать</span>}
      </p>
      <AnimatePresence initial={false} mode="wait">
        {done ? (
          <motion.div
            key="actions"
            className={styles.actions}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring}
          >
            <Pill tone="dark" className={styles.send} onClick={() => onSend(DEMO_PROMPT)}>
              Отправить
            </Pill>
            <Pill tone="ghost" onClick={() => onEdit(DEMO_PROMPT)}>
              Исправить
            </Pill>
            <Pill tone="ghost" onClick={onCancel}>
              Отмена
            </Pill>
          </motion.div>
        ) : (
          <motion.div key="stop" className={styles.actions} exit={{ opacity: 0 }}>
            <Pill tone="ghost" small onClick={onCancel}>
              Отмена
            </Pill>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
