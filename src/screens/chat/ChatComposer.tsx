import { AnimatePresence, m } from 'framer-motion'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigation } from '../../app/navigation'
import { ArrowRightIcon, BackIcon, CloseIcon, ImageIcon, MicIcon, StopIcon } from '../../components/Icons'
import { CircleButton, Pill, Waveform } from '../../components/ui'
import { useKeyboardInset } from '../../lib/hooks'
import { compressImage } from '../../lib/image'
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
  canAttach,
  compact,
  onTyping,
  onSend,
}: {
  initialText: string
  focusOnMount: boolean
  /** Ассистент отвечает — повторная отправка заблокирована. */
  busy?: boolean
  /** Можно приложить картинку (только с сервером). */
  canAttach?: boolean
  /** Режим набора на телефоне: подсказки прячутся, чтобы над клавиатурой осталось место для ленты. */
  compact?: boolean
  /** Поле получило или потеряло фокус. */
  onTyping?: (focused: boolean) => void
  onSend: (text: string, image?: string) => void
}) {
  const { back } = useNavigation()
  const [text, setText] = useState(initialText)
  const [category, setCategory] = useState<ChatCategoryId | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const [image, setImage] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const kb = useKeyboardInset()

  const attach = async (picked: File | undefined) => {
    if (!picked) return
    setImageError(null)
    try {
      setImage(await compressImage(picked))
    } catch {
      setImageError('Не получилось открыть картинку')
    }
  }

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
    if ((value || image) && !busy) {
      stop()
      setText('')
      setImage(null)
      base.current = ''
      onSend(value, image ?? undefined)
    }
  }
  const ready = Boolean(text || image)

  const active = CHAT_CATEGORIES.find((c) => c.id === category)
  const chipsKey = text ? 'quick' : active ? `cat-${active.id}` : 'cats'

  return (
    <m.div
      className={styles.composer}
      style={{ paddingBottom: `max(var(--safe-bottom), ${kb + 10}px)` }}
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ ...softSpring, delay: 0.1 }}
      // Нажатие на кнопки и подсказки не уводит фокус из поля: клавиатура не закрывается и не прыгает экран.
      onPointerDown={(e) => {
        if (e.target instanceof Element && e.target.closest('button') && document.activeElement === input.current) {
          e.preventDefault()
        }
      }}
    >
      <AnimatePresence initial={false}>
        {!compact && (
          <m.div
            key="chips"
            className={styles.chipsFold}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
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
          </m.div>
        )}
      </AnimatePresence>

      {(image || imageError) && (
        <div className={styles.attachment}>
          {image && <img src={image} alt="Прикреплённая картинка" className={styles.attachmentThumb} />}
          <span className={styles.attachmentText} role={imageError ? 'alert' : undefined}>
            {imageError ?? 'Картинка уйдёт с сообщением'}
          </span>
          <CircleButton
            tone="glass"
            size={40}
            onClick={() => {
              setImage(null)
              setImageError(null)
            }}
            aria-label="Убрать картинку"
          >
            <CloseIcon size={14} />
          </CircleButton>
        </div>
      )}

      <div className={styles.row}>
        <CircleButton tone="glass" size={48} onClick={back} aria-label="Закрыть чат">
          <BackIcon size={20} />
        </CircleButton>
        <label className={styles.input}>
          <textarea
            ref={input}
            rows={1}
            value={text}
            onFocus={() => onTyping?.(true)}
            onBlur={() => onTyping?.(false)}
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
            placeholder={listening ? 'Слушаю…' : image ? 'Что с ней сделать?' : 'Спросите что угодно…'}
            enterKeyHint="send"
            aria-label="Сообщение"
          />
          {listening && text.length < 6 && (
            <span className={styles.dictation}>
              <Waveform bars={14} height={18} color="var(--ink-3)" />
            </span>
          )}
          {canAttach && !listening && (
            <button
              type="button"
              className={styles.attachBtn}
              onClick={() => file.current?.click()}
              aria-label="Приложить фото или скриншот"
            >
              <ImageIcon size={20} />
            </button>
          )}
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void attach(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
        <AnimatePresence mode="popLayout" initial={false}>
          {ready && !listening ? (
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
