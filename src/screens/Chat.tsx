import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { useApp, useBar } from '../app/store'
import { ArrowRightIcon, BackIcon, InfinityIcon, MicIcon, PaperclipIcon } from '../components/Icons'
import { CircleButton, Pill, Pressable, Waveform } from '../components/ui'
import { CHAT_CATEGORIES, DEMO_PROMPT, QUICK_PROMPTS } from '../data'
import { useKeyboardInset } from '../lib/hooks'
import { itemVariants, softSpring, spring } from '../lib/motion'
import styles from './Chat.module.css'

export function Chat() {
  const { back, go, setPrompt } = useApp()
  const [text, setText] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [typing, setTyping] = useState<'idle' | 'auto' | 'dictation'>('idle')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const kb = useKeyboardInset()

  useBar({ key: 'chat', hidden: true }, [])

  useEffect(() => () => window.clearInterval(timer.current), [])

  // Поле растёт вместе с текстом, как в iMessage.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`
  }, [text])

  /** Печатает подсказку в поле по буквам — как будто её набирают. */
  const typeIn = (value: string, mode: 'auto' | 'dictation') => {
    window.clearInterval(timer.current)
    setTyping(mode)
    let i = 0
    setText('')
    timer.current = window.setInterval(
      () => {
        i += mode === 'dictation' ? 2 : 1
        setText(value.slice(0, i))
        if (i >= value.length) {
          window.clearInterval(timer.current)
          setTyping('idle')
        }
      },
      mode === 'dictation' ? 45 : 22,
    )
  }

  const send = () => {
    const value = text.trim()
    if (!value) return
    setPrompt(value)
    go('agent')
  }

  const active = CHAT_CATEGORIES.find((c) => c.id === category)
  const chipsKey = text ? 'quick' : active ? `cat-${active.id}` : 'cats'

  return (
    <div className={styles.screen}>
      <motion.div
        className={styles.live}
        initial={{ scaleX: 0.6, opacity: 0 }}
        animate={{ scaleX: 1, opacity: 1 }}
        transition={{ ...spring, delay: 0.15 }}
      >
        <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>
          <b className="tnum">2</b> задачи
        </motion.span>
        <motion.i
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, rotate: 360 }}
          transition={{ opacity: { delay: 0.35 }, rotate: { duration: 6, repeat: Infinity, ease: 'linear' } }}
        />
      </motion.div>

      <motion.button
        type="button"
        className={styles.preview}
        onClick={() => go('day')}
        initial={{ y: 180, scale: 1.5, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        transition={softSpring}
        whileTap={{ scale: 0.97 }}
        aria-label="Открыть день"
      >
        <span className={styles.previewHead}>
          Утро <i />
        </span>
        {[
          ['06:00', 'Сон', '4 ч глубокого'],
          ['08:00', 'Утренняя рутина', ''],
          ['10:30', 'Подготовка к созвону', 'A301'],
        ].map(([t, title, sub]) => (
          <span key={t} className={styles.previewRow}>
            <span className="tnum">{t}</span>
            <span className={styles.previewCard}>
              {title}
              {sub && <small>{sub}</small>}
            </span>
          </span>
        ))}
      </motion.button>

      <motion.h1 variants={itemVariants} className={styles.title}>
        Сегодня
      </motion.h1>

      <div className={`${styles.messages} scroll-y`}>
        <motion.p
          className={styles.bubble}
          initial={{ opacity: 0, y: 12, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ ...spring, delay: 0.3 }}
          style={{ originX: 0, originY: 1 }}
        >
          Чем могу помочь?
        </motion.p>
      </div>

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
                  <Pill key={q.label} small tone="glass" onClick={() => typeIn(q.prompt, 'auto')}>
                    {q.label}
                  </Pill>
                ))
              ) : active ? (
                <>
                  <CircleButton
                    tone="glass"
                    size={34}
                    onClick={() => setCategory(null)}
                    aria-label="Назад к категориям"
                  >
                    <BackIcon size={16} />
                  </CircleButton>
                  {active.prompts.map((p) => (
                    <Pill key={p} small tone="glass" onClick={() => typeIn(p, 'auto')}>
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
          <CircleButton tone="glass" size={48} onClick={back} aria-label="Назад">
            <InfinityIcon size={22} />
          </CircleButton>
          <label className={styles.input}>
            <textarea
              ref={inputRef}
              rows={1}
              value={text}
              onChange={(e) => {
                window.clearInterval(timer.current)
                setTyping('idle')
                setText(e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder={typing === 'dictation' ? '' : 'Спросите что угодно…'}
              enterKeyHint="send"
              aria-label="Сообщение"
            />
            {typing === 'dictation' && text.length < 6 ? (
              <span className={styles.dictation}>
                <Waveform bars={14} height={18} color="rgba(60,60,90,0.5)" />
              </span>
            ) : (
              <Pressable className={styles.attach} aria-label="Прикрепить">
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
                  className={typing === 'idle' ? styles.sendReady : undefined}
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
                  onClick={() => typeIn(DEMO_PROMPT, 'dictation')}
                  aria-label="Диктовать"
                >
                  <MicIcon size={20} />
                </CircleButton>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}
