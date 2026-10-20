import { motion } from 'framer-motion'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useAssistant } from '../../app/assistant'
import { BarSlot } from '../../app/bar'
import { useNavigation } from '../../app/navigation'
import { itemVariants, spring } from '../../lib/motion'
import { ChatComposer } from './ChatComposer'
import { DayPreview } from './DayPreview'
import { TasksPill } from './TasksPill'
import styles from './Chat.module.css'

export function Chat() {
  const { go } = useNavigation()
  const { messages, addMessage, setPrompt, draft, setDraft } = useAssistant()
  const list = useRef<HTMLDivElement>(null)

  // Черновик (например, запрос, который нужно поправить) забираем в поле один раз.
  const [initialText] = useState(draft)
  const consumeDraft = useEffectEvent(() => {
    if (draft) setDraft('')
  })
  useEffect(() => consumeDraft(), [])

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [messages.length])

  const send = (text: string) => {
    addMessage('user', text)
    setPrompt(text)
    go('agent')
  }

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
      </div>

      <ChatComposer initialText={initialText} focusOnMount={Boolean(initialText)} onSend={send} />
    </div>
  )
}
