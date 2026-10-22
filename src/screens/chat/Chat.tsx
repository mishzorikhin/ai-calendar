import { AnimatePresence, m } from 'framer-motion'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useApi } from '../../api/provider'
import {
  IMAGE_MARK,
  useChatConfirms,
  useMessages,
  useSendChat,
  type ChatStream,
  type FailedMessage,
} from '../../api/queries'
import { useAssistant } from '../../app/assistant'
import { BarSlot } from '../../app/bar'
import { useCalendar } from '../../app/calendar'
import { useNavigation } from '../../app/navigation'
import { Dots, Pressable } from '../../components/ui'
import { fromISODate } from '../../lib/dates'
import { useTimeout } from '../../lib/hooks'
import { itemVariants, spring } from '../../lib/motion'
import { ChatComposer } from './ChatComposer'
import { ConfirmCard } from './ConfirmCard'
import { DayPreview } from './DayPreview'
import { MemoryNote } from './MemoryNote'
import { TasksPill } from './TasksPill'
import styles from './Chat.module.css'

/** Насколько близко к низу ленты считаем, что человек «следит» за ответом. */
const STICK_PX = 80

/** Сенсорный экран — там при наборе открывается клавиатура и места становится вдвое меньше. */
const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true

const TOOL_LABELS: Record<string, string> = {
  get_day_schedule: 'Смотрю расписание',
  find_free_slots: 'Ищу свободное время',
  create_event: 'Создаю событие',
  update_event: 'Меняю событие',
  delete_event: 'Удаление события',
  list_tasks: 'Смотрю задачи',
  list_users: 'Ищу людей',
  create_task: 'Добавляю задачу',
  update_task: 'Обновляю задачу',
  delete_task: 'Удаление задачи',
  create_reminder: 'Ставлю напоминание',
  list_reminders: 'Смотрю напоминания',
  update_profile: 'Обновляю профиль',
  forget: 'Забываю',
  list_memories: 'Вспоминаю',
  list_people: 'Смотрю людей',
  forget_person: 'Забываю человека',
  respond_invitation: 'Отвечаю на приглашение',
  plan_tasks: 'Раскладываю задачи',
  shift_events: 'Перенос событий',
  clear_day: 'Освобождение дня',
}

export function Chat() {
  const { prompt, setPrompt, draft, setDraft } = useAssistant()
  const messages = useMessages()
  const confirms = useChatConfirms()
  const { stream, busy, send, failed, dismissFailed, remembered } = useSendChat()
  const api = useApi()
  const list = useRef<HTMLDivElement>(null)

  // Черновик (например, запрос, который нужно поправить) забираем в поле один раз.
  const [initialText] = useState(draft)
  const consumeDraft = useEffectEvent(() => {
    if (draft) setDraft('')
  })
  useEffect(() => consumeDraft(), [])

  // Ленту ведём вниз за ответом, только если человек сам не ушёл читать историю выше.
  const stick = useRef(true)
  const onScroll = () => {
    const el = list.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
  }
  useEffect(() => {
    if (stick.current) list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [messages.length, stream?.text, stream?.tools.length, failed.length, confirms.length, stream?.confirms.length])

  // Лента меняет высоту (открылась клавиатура, свернулась шапка) — остаёмся у последнего сообщения.
  useEffect(() => {
    const el = list.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Режим набора: пока поле в фокусе на телефоне, превью дня и заголовок сворачиваются —
  // над клавиатурой остаются сообщения. Разворачиваем с задержкой: короткая потеря фокуса
  // (нажатие на подсказку) не должна дёргать экран.
  const [focused, setFocused] = useState(false)
  const [compact, setCompact] = useState(false)
  useTimeout(() => setCompact(false), !focused && compact ? 250 : null)
  const onTyping = (on: boolean) => {
    setFocused(on)
    if (on && touch) setCompact(true)
  }

  /** Своё сообщение всегда показываем: прокрутка возвращается вниз. */
  const sendAndFollow = (text: string, image?: string) => {
    stick.current = true
    void send(text, image)
  }

  // Запрос от голосового ввода или «поручить ассистенту» — отправляем сразу.
  const consumePrompt = useEffectEvent(() => {
    const text = prompt.trim()
    if (text) {
      setPrompt('')
      sendAndFollow(text)
    }
  })
  useEffect(() => consumePrompt(), [])

  return (
    <div className={styles.screen}>
      <BarSlot id="chat" hidden />
      <TasksPill />
      <div className={styles.top}>
        <AnimatePresence initial={false}>
          {!compact && (
            <m.div
              key="head"
              className={styles.head}
              // Обрезаем только пока сворачиваемся: иначе срезался бы вход «день уменьшается в карточку».
              initial={{ height: 0, opacity: 0, overflow: 'hidden' }}
              animate={{ height: 'auto', opacity: 1, transitionEnd: { overflow: 'visible' } }}
              exit={{ height: 0, opacity: 0, overflow: 'hidden' }}
              transition={spring}
            >
              <DayPreview />
              <m.h1 variants={itemVariants} className={styles.title}>
                Сегодня
              </m.h1>
            </m.div>
          )}
        </AnimatePresence>
      </div>

      <div
        ref={list}
        className={`${styles.messages} scroll-y`}
        role="log"
        aria-label="Диалог с ассистентом"
        onScroll={onScroll}
      >
        {messages.map((msg, i) => (
          <m.p
            key={msg.id}
            className={`${styles.bubble} ${msg.role === 'user' ? styles.bubbleUser : ''}`}
            initial={{ opacity: 0, y: 12, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ ...spring, delay: i === messages.length - 1 ? 0.25 : 0 }}
            style={{ originX: msg.role === 'user' ? 1 : 0, originY: 1 }}
          >
            {msg.text}
          </m.p>
        ))}
        {stream ? (
          <>
            <StreamReply stream={stream} />
            <MemoryNote items={stream.memory} />
            {stream.confirms.map((c) => (
              <ConfirmCard key={c.id} confirm={c} disabled />
            ))}
          </>
        ) : (
          <>
            <MemoryNote items={remembered} />
            {confirms.map((c) => (
              <ConfirmCard key={c.id} confirm={c} />
            ))}
          </>
        )}
        {failed.map((msg) => (
          <FailedBubble
            key={msg.id}
            message={msg}
            busy={busy}
            onRetry={() => sendAndFollow(msg.text, msg.image)}
            onDismiss={() => dismissFailed(msg.id)}
          />
        ))}
      </div>

      <ChatComposer
        initialText={initialText}
        focusOnMount={Boolean(initialText)}
        busy={busy}
        compact={compact && messages.length > 1}
        onTyping={onTyping}
        canAttach={api.mode === 'server'}
        onSend={sendAndFollow}
      />
    </div>
  )
}

/** Ответ, который ещё пишется: статусы инструментов и растущий текст. */
function StreamReply({ stream }: { stream: ChatStream }) {
  const { go } = useNavigation()
  const { setSelectedDate } = useCalendar()
  const openDay = (iso: string) => {
    setSelectedDate(fromISODate(iso))
    go('day')
  }
  return (
    <m.div
      className={styles.stream}
      initial={{ opacity: 0, y: 12, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
      style={{ originX: 0, originY: 1 }}
    >
      {stream.tools.length > 0 && (
        <div className={styles.tools}>
          {stream.tools.map((t, i) =>
            t.date ? (
              <Pressable
                key={i}
                scale={0.95}
                className={`${styles.tool} ${t.done ? styles.toolDone : ''} ${styles.toolLink}`}
                onClick={() => t.date && openDay(t.date)}
                aria-label={`Открыть день ${t.date}`}
              >
                {TOOL_LABELS[t.name] ?? t.name}
                {t.done && t.detail ? ` · ${t.detail}` : t.done ? '' : '…'} →
              </Pressable>
            ) : (
              <span key={i} className={`${styles.tool} ${t.done ? styles.toolDone : ''}`}>
                {TOOL_LABELS[t.name] ?? t.name}
                {t.done && t.detail ? ` · ${t.detail}` : t.done ? '' : '…'}
              </span>
            ),
          )}
        </div>
      )}
      <p className={styles.bubble}>
        {stream.text || stream.error ? (
          <>
            {stream.text}
            {stream.error && <span className={styles.streamError}>{stream.error}</span>}
          </>
        ) : (
          <Dots />
        )}
      </p>
    </m.div>
  )
}

/**
 * Сообщение без ответа. Не доставлено — тусклый пузырь с «повторить/убрать».
 * Доставлено, но ответ оборвался — реплика уже в истории, показываем только строку
 * с ошибкой и «спросить ещё раз», чтобы не дублировать пузырь.
 */
function FailedBubble({
  message,
  busy,
  onRetry,
  onDismiss,
}: {
  message: FailedMessage
  /** Ассистент отвечает на другое сообщение — повтор недоступен. */
  busy: boolean
  onRetry: () => void
  onDismiss: () => void
}) {
  return (
    <m.div
      className={`${styles.failed} ${message.delivered ? styles.failedReply : ''}`}
      initial={{ opacity: 0, y: 12, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
      style={{ originX: message.delivered ? 0 : 1, originY: 1 }}
      role="status"
    >
      {!message.delivered && (
        <p className={`${styles.bubble} ${styles.bubbleUser} ${styles.bubbleFailed}`}>
          {message.image ? `${message.text}\n${IMAGE_MARK}`.trim() : message.text}
        </p>
      )}
      <p className={styles.failedMeta}>
        {message.delivered ? message.error : `Не отправлено — ${message.error}`}
        <button type="button" className={styles.failedRetry} onClick={onRetry} disabled={busy}>
          {message.delivered ? 'Спросить ещё раз' : 'Повторить'}
        </button>
        <button type="button" className={styles.failedDismiss} onClick={onDismiss} aria-label="Убрать сообщение">
          Убрать
        </button>
      </p>
    </m.div>
  )
}
