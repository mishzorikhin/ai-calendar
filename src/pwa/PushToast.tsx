import { AnimatePresence, m } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useApi } from '../api/provider'
import { useUpdateTask } from '../api/queries'
import { BellIcon, CloseIcon } from '../components/Icons'
import { Pill, Pressable } from '../components/ui'
import { useTimeout } from '../lib/hooks'
import { spring } from '../lib/motion'
import { VIBRATION, parsePushMessage, type PushMessage } from './pushMessage'
import { openFromNotification } from './usePushEvents'
import styles from './pwa.module.css'

/** Сколько плашка висит, если её не трогать. */
const SHOW_MS = 7000

/**
 * Уведомление, пришедшее, пока приложение открыто: вместо системного (service worker его не
 * показывает) — плашка в стиле приложения. Нажатие открывает нужный экран, у задачи — «Готово».
 */
export function PushToast() {
  const api = useApi()
  const updateTask = useUpdateTask()
  const [msg, setMsg] = useState<PushMessage | null>(null)
  // Ключ показа: новое уведомление перезапускает таймер, даже если текст тот же.
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (api.mode !== 'server' || !('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: unknown; message?: unknown } | null
      if (data?.type !== 'push:show') return
      const next = parsePushMessage(data.message)
      setMsg(next)
      setShown((n) => n + 1)
      try {
        navigator.vibrate?.(VIBRATION[next.kind])
      } catch {
        /* вибрации нет (iOS, компьютер) */
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [api])

  useTimeout(() => setMsg(null), msg ? SHOW_MS : null, shown)

  const taskId = msg?.taskId
  const open = () => {
    if (msg?.url) openFromNotification(msg.url)
    setMsg(null)
  }

  return (
    <AnimatePresence>
      {msg && (
        <m.div
          key={shown}
          className={styles.push}
          role="status"
          initial={{ opacity: 0, y: -24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16 }}
          transition={spring}
        >
          <Pressable className={styles.pushBody} scale={0.98} onClick={open}>
            <span className={styles.pushIcon}>
              <BellIcon size={17} />
            </span>
            <span className={styles.pushText}>
              <span className={styles.pushTitle}>{msg.title}</span>
              {msg.body && <span className={styles.pushSub}>{msg.body}</span>}
            </span>
          </Pressable>
          {msg.kind === 'task' && taskId && (
            <Pill
              small
              tone="white"
              onClick={() => {
                updateTask.mutate({ id: taskId, patch: { done: true } })
                setMsg(null)
              }}
            >
              Готово
            </Pill>
          )}
          <Pressable className={styles.pushClose} onClick={() => setMsg(null)} aria-label="Скрыть уведомление">
            <CloseIcon size={16} />
          </Pressable>
        </m.div>
      )}
    </AnimatePresence>
  )
}
