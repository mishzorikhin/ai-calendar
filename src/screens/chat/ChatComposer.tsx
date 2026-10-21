import { AnimatePresence, m } from 'framer-motion'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigation } from '../../app/navigation'
import { ArrowRightIcon, BackIcon, CloseIcon, MicIcon, StopIcon } from '../../components/Icons'
import { CircleButton, Pill, Waveform } from '../../components/ui'
import { useKeyboardInset } from '../../lib/hooks'
import { softSpring, spring } from '../../lib/motion'
import { useDictation } from '../../lib/speech'
import { CHAT_CATEGORIES, QUICK_PROMPTS, type ChatCategoryId } from '../../mocks/assistant'
import styles from './Chat.module.css'

const MAX_INPUT_H = 112

/** Поле ввода чата: подсказки по категориям, растущее поле, диктовка через Web Speech API. */
export function ChatComposer({
  initialText,
  focusOnMount,
  busy,
  onSend,
}: {
  initialText: string
  focusOnMount: boolean
  /** Ассистент отвечает — повторная отправка заблокирована. */
  busy?: boolean
  onSend: (text: string) => void
}) {
  const { back } = useNavigation()
  const [text, setText] = useState(initialText)
  const [category, setCategory] = useState<ChatCategoryId | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const kb = useKeyboardInset()

  // Диктовка: распознанный текст дописывается к тому, что уже было в поле.
  const base = useRef('')
  // Начали печатать посреди диктовки — она останавливается, а поздние результаты
  // распознавания больше не перезаписывают набранное руками.
  const typed = useRef(false)
  const { listening, start, stop, supported } = useDictation((final, interim) => {
    if (typed.current) return
    const extra = [final.trim(), interim.trim()].filter(Boolean).join(' ')
    setText(base.current + (extra ? `${base.current ? ' ' : ''}${extra}` : ''))
  })

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
    stop()
    setText(value)
    input.current?.focus()
  }

  const toggleDictation = () => {
    if (listening) {
      stop()
      input.current?.focus()
      return
    }
    base.current = text.trim()
    typed.current = false
    start()
  }

  const send = () => {
    const value = text.trim()
    if (value && !busy) {
      stop()
      setText('')
      base.current = ''
      onSend(value)
    }
  }

  const active = CHAT_CATEGORIES.find((c) => c.id === category)
  const chipsKey = text ? 'quick' : active ? `cat-${active.id}` : 'cats'

  return (
    <m.div
      className={styles.composer}
      style={{ paddingBottom: `max(var(--safe-bottom), ${kb + 10}px)` }}
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ ...softSpring, delay: 0.1 }}
    >
      <div className={styles.chipsViewport}>
        <AnimatePresence mode="popLayout" initial={false}>
          <m.div
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
                <Pill
                  small
                  tone="dark"
                  onClick={() => setCategory(null)}
                  aria-label={`Убрать категорию ${active.label}`}
                  className={styles.categoryPill}
                >
                  {active.label}
                  <CloseIcon size={12} strokeWidth={2.6} />
                </Pill>
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
          </m.div>
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
              if (listening) {
                typed.current = true
                stop()
              }
              setText(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder={listening ? 'Слушаю…' : 'Спросите что угодно…'}
            enterKeyHint="send"
            aria-label="Сообщение"
          />
          {listening && text.length < 6 && (
            <span className={styles.dictation}>
              <Waveform bars={14} height={18} color="rgba(60,60,90,0.5)" />
            </span>
          )}
        </label>
        <AnimatePresence mode="popLayout" initial={false}>
          {text && !listening ? (
            <m.span
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
                disabled={busy}
                aria-label="Отправить"
                className={busy ? undefined : styles.sendReady}
              >
                <ArrowRightIcon size={20} strokeWidth={2.2} />
              </CircleButton>
            </m.span>
          ) : supported ? (
            <m.span
              key="mic"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={spring}
            >
              <CircleButton
                tone={listening ? 'dark' : 'white'}
                size={48}
                onClick={toggleDictation}
                aria-label={listening ? 'Остановить диктовку' : 'Диктовать'}
                aria-pressed={listening}
              >
                {listening ? <StopIcon size={18} /> : <MicIcon size={20} />}
              </CircleButton>
            </m.span>
          ) : null}
        </AnimatePresence>
      </div>
    </m.div>
  )
}
