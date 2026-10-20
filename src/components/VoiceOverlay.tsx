import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useApp } from '../app/store'
import { DEMO_PROMPT } from '../data'
import { softSpring, spring } from '../lib/motion'
import { Pill } from './ui'
import styles from './VoiceOverlay.module.css'

const WORDS = DEMO_PROMPT.split(' ')

/**
 * Голосовой ввод: слова «распознаются» по одному.
 * Запрос не уходит сам — пользователь проверяет текст и отправляет или исправляет его.
 */
export function VoiceOverlay() {
  const { voice, setVoice, setPrompt, go, route, setDraft, addMessage } = useApp()

  return (
    <AnimatePresence>
      {voice && route !== 'chat' && route !== 'agent' && (
        <motion.div
          key="voice"
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
          onClick={() => setVoice(false)}
        >
          <Listening
            onSend={(text) => {
              setPrompt(text)
              addMessage('user', text)
              setVoice(false)
              go('agent')
            }}
            onEdit={(text) => {
              setDraft(text)
              setVoice(false)
              go('chat')
            }}
            onCancel={() => setVoice(false)}
            onRecognized={() => setVoice('review')}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Listening({
  onSend,
  onEdit,
  onCancel,
  onRecognized,
}: {
  onSend: (text: string) => void
  onEdit: (text: string) => void
  onCancel: () => void
  onRecognized: () => void
}) {
  const [count, setCount] = useState(0)
  const done = count >= WORDS.length

  useEffect(() => {
    if (done) {
      onRecognized()
      return
    }
    const id = window.setTimeout(() => setCount((c) => c + 1), count === 0 ? 650 : 120 + (count % 3) * 30)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, done])

  return (
    <motion.div
      className={styles.panel}
      initial={{ y: 40, opacity: 0, scale: 0.96 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: 30, opacity: 0 }}
      transition={softSpring}
      onClick={(e) => e.stopPropagation()}
    >
      <span className={styles.label}>
        {!done && (
          <motion.i
            animate={{ scale: [1, 1.5, 1], opacity: [1, 0.4, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
        )}
        {count === 0 ? 'Слушаю…' : done ? 'Проверьте, правильно ли я понял' : 'Распознаю речь'}
      </span>
      <p className={styles.text}>
        {WORDS.slice(0, count).map((w, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, y: 8, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.35 }}
          >
            {w}{' '}
          </motion.span>
        ))}
        {count === 0 && <span className={styles.placeholder}>Скажите, что нужно запланировать</span>}
      </p>
      <AnimatePresence initial={false}>
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
