import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../app/store'
import { DEMO_PROMPT } from '../data'
import { softSpring } from '../lib/motion'
import styles from './VoiceOverlay.module.css'

const WORDS = DEMO_PROMPT.split(' ')

/** Голосовой ввод: слова «распознаются» по одному, затем запрос уходит ассистенту. */
export function VoiceOverlay() {
  const { voice, setVoice, setPrompt, go, route } = useApp()

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
            onDone={() => {
              setPrompt(DEMO_PROMPT)
              setVoice(false)
              go('agent')
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Listening({ onDone }: { onDone: () => void }) {
  const [count, setCount] = useState(0)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    if (count >= WORDS.length) {
      const id = window.setTimeout(() => doneRef.current(), 750)
      return () => window.clearTimeout(id)
    }
    const id = window.setTimeout(() => setCount((c) => c + 1), count === 0 ? 650 : 150 + (count % 3) * 40)
    return () => window.clearTimeout(id)
  }, [count])

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
        <motion.i
          animate={{ scale: [1, 1.5, 1], opacity: [1, 0.4, 1] }}
          transition={{ duration: 1.2, repeat: Infinity }}
        />
        {count === 0 ? 'Слушаю…' : 'Распознаю речь'}
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
    </motion.div>
  )
}
