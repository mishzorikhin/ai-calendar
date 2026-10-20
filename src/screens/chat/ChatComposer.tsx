import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigation } from '../../app/navigation'
import { ArrowRightIcon, BackIcon, MicIcon, PaperclipIcon } from '../../components/Icons'
import { CircleButton, Pill, Pressable, Waveform } from '../../components/ui'
import { useInterval, useKeyboardInset } from '../../lib/hooks'
import { softSpring, spring } from '../../lib/motion'
import { CHAT_CATEGORIES, DEMO_PROMPT, QUICK_PROMPTS, type ChatCategoryId } from '../../mocks/assistant'
import styles from './Chat.module.css'

const MAX_INPUT_H = 112
const DICTATION_STEP_MS = 45
const DICTATION_CHARS = 2

/** Поле ввода чата: подсказки по категориям, растущее поле, имитация диктовки. */
export function ChatComposer({
  initialText,
  focusOnMount,
  onSend,
}: {
  initialText: string
  focusOnMount: boolean
  onSend: (text: string) => void
}) {
  const { back } = useNavigation()
  const [text, setText] = useState(initialText)
  const [category, setCategory] = useState<ChatCategoryId | null>(null)
  // Диктовка: какой текст «надиктовывается» и сколько символов уже появилось.
  const [dictation, setDictation] = useState<{ value: string; shown: number } | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const kb = useKeyboardInset()

  useInterval(
    () => {
      if (!dictation) return
      const shown = Math.min(dictation.shown + DICTATION_CHARS, dictation.value.length)
      setText(dictation.value.slice(0, shown))
      setDictation(shown >= dictation.value.length ? null : { ...dictation, shown })
    },
    dictation ? DICTATION_STEP_MS : null,
  )

  // Пришли «поправить запрос» — сразу ставим курсор в поле.
  useEffect(() => {
    if (focusOnMount) input.current?.focus()
  }, [focusOnMount])

  // Поле растёт вместе с текстом, как в iMessage.
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_H)}px`
  }, [text])

  /** Подсказка сразу попадает в поле — её можно отредактировать перед отправкой. */
  const insert = (value: string) => {
    setDictation(null)
    setText(value)
    input.current?.focus()
  }

  const send = () => {
    const value = text.trim()
    if (value) onSend(value)
  }

  const active = CHAT_CATEGORIES.find((c) => c.id === category)
  const chipsKey = text ? 'quick' : active ? `cat-${active.id}` : 'cats'

  return (
    <motion.div
      className={styles.composer}
      style={{ paddingBottom: `max(var(--safe-bottom), ${kb + 10}px)` }}
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ ...softSpring, delay: 0.1 }}
    >
      <div className={styles.chipsViewport}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={chipsKey}
            className={`${styles.chips} scroll-x`}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={spring}
          >
            {text ? (
              QUICK_PROMPTS.map((q) => (
                <Pill key={q.label} small tone="glass" onClick={() => insert(q.prompt)}>
                  {q.label}
                </Pill>
              ))
            ) : active ? (
              <>
                <CircleButton tone="glass" size={40} onClick={() => setCategory(null)} aria-label="Назад к категориям">
                  <BackIcon size={16} />
                </CircleButton>
                {active.prompts.map((p) => (
                  <Pill key={p} small tone="glass" onClick={() => insert(p)}>
                    {p}
                  </Pill>
                ))}
              </>
            ) : (
              CHAT_CATEGORIES.map((c) => (
                <Pill key={c.id} small tone="glass" onClick={() => setCategory(c.id)}>
                  {c.label}
                </Pill>
              ))
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className={styles.row}>
        <CircleButton tone="glass" size={48} onClick={back} aria-label="Закрыть чат">
          <BackIcon size={20} />
        </CircleButton>
        <label className={styles.input}>
          <textarea
            ref={input}
            rows={1}
            value={text}
            onChange={(e) => {
              setDictation(null)
              setText(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={dictation ? '' : 'Спросите что угодно…'}
            enterKeyHint="send"
            aria-label="Сообщение"
          />
          {dictation && text.length < 6 ? (
            <span className={styles.dictation}>
              <Waveform bars={14} height={18} color="rgba(60,60,90,0.5)" />
            </span>
          ) : (
            <Pressable className={styles.attach} aria-label="Прикрепить файл">
              <PaperclipIcon size={19} />
            </Pressable>
          )}
        </label>
        <AnimatePresence mode="popLayout" initial={false}>
          {text ? (
            <motion.span
              key="send"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={spring}
            >
              <CircleButton
                tone="dark"
                size={48}
                onClick={send}
                aria-label="Отправить"
                className={dictation ? undefined : styles.sendReady}
              >
                <ArrowRightIcon size={20} strokeWidth={2.2} />
              </CircleButton>
            </motion.span>
          ) : (
            <motion.span
              key="mic"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={spring}
            >
              <CircleButton
                tone="white"
                size={48}
                onClick={() => {
                  setText('')
                  setDictation({ value: DEMO_PROMPT, shown: 0 })
                }}
                aria-label="Диктовать"
              >
                <MicIcon size={20} />
              </CircleButton>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
