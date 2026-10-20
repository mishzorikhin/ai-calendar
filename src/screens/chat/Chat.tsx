import { motion } from 'framer-motion'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useMessages, useSendChat, type ChatStream, type FailedMessage } from '../../api/queries'
import { useAssistant } from '../../app/assistant'
import { BarSlot } from '../../app/bar'
import { useCalendar } from '../../app/calendar'
import { useNavigation } from '../../app/navigation'
import { Dots, Pressable } from '../../components/ui'
import { fromISODate } from '../../lib/dates'
import { itemVariants, spring } from '../../lib/motion'
import { ChatComposer } from './ChatComposer'
import { DayPreview } from './DayPreview'
import { TasksPill } from './TasksPill'
import styles from './Chat.module.css'

const TOOL_LABELS: Record<string, string> = {
  get_day_schedule: 'Смотрю расписание',
  find_free_slots: 'Ищу свободное время',
  create_event: 'Создаю событие',
  delete_event: 'Удаляю событие',
  list_tasks: 'Смотрю задачи',
  create_task: 'Добавляю задачу',
  update_task: 'Обновляю задачу',
  delete_task: 'Удаляю задачу',
}

export function Chat() {
  const { prompt, setPrompt, draft, setDraft } = useAssistant()
  const messages = useMessages()
  const { stream, send, failed, dismissFailed } = useSendChat()
  const list = useRef<HTMLDivElement>(null)

  // Черновик (например, запрос, который нужно поправить) забираем в поле один раз.
  const [initialText] = useState(draft)
  const consumeDraft = useEffectEvent(() => {
    if (draft) setDraft('')
  })
  useEffect(() => consumeDraft(), [])

  // Запрос от голосового ввода или «поручить ассистенту» — отправляем сразу.
  const consumePrompt = useEffectEvent(() => {
    const text = prompt.trim()
    if (text) {
      setPrompt('')
      void send(text)
    }
  })
  useEffect(() => consumePrompt(), [])

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [messages.length, stream?.text, stream?.tools.length, failed.length])

  return (
    <div className={styles.screen}>
      <BarSlot id="chat" hidden />
      <TasksPill />
      <DayPreview />

      <motion.h1 variants={itemVariants} className={styles.title}>
        Сегодня
      </motion.h1>

      <div ref={list} className={`${styles.messages} scroll-y`} role="log" aria-label="Диалог с ассистентом">
        {messages.map((m, i) => (
          <motion.p
            key={m.id}
            className={`${styles.bubble} ${m.role === 'user' ? styles.bubbleUser : ''}`}
            initial={{ opacity: 0, y: 12, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ ...spring, delay: i === messages.length - 1 ? 0.25 : 0 }}
            style={{ originX: m.role === 'user' ? 1 : 0, originY: 1 }}
          >
            {m.text}
          </motion.p>
        ))}
        {stream && <StreamReply stream={stream} />}
        {failed.map((m) => (
          <FailedBubble
            key={m.id}
            message={m}
            onRetry={() => void send(m.text)}
            onDismiss={() => dismissFailed(m.id)}
          />
        ))}
      </div>

      <ChatComposer
        initialText={initialText}
        focusOnMount={Boolean(initialText)}
        busy={Boolean(stream && !stream.done)}
        onSend={(text) => void send(text)}
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
    <motion.div
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
    </motion.div>
  )
}

/** Пузырь недоставленного сообщения: тусклый, с ошибкой и кнопками «повторить/убрать». */
function FailedBubble({
  message,
  onRetry,
  onDismiss,
}: {
  message: FailedMessage
  onRetry: () => void
  onDismiss: () => void
}) {
  return (
    <motion.div
      className={styles.failed}
      initial={{ opacity: 0, y: 12, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
      style={{ originX: 1, originY: 1 }}
    >
      <p className={`${styles.bubble} ${styles.bubbleUser} ${styles.bubbleFailed}`}>{message.text}</p>
      <p className={styles.failedMeta}>
        Не отправлено — {message.error}
        <button type="button" className={styles.failedRetry} onClick={onRetry}>
          Повторить
        </button>
        <button type="button" className={styles.failedDismiss} onClick={onDismiss} aria-label="Убрать сообщение">
          Убрать
        </button>
      </p>
    </motion.div>
  )
}
