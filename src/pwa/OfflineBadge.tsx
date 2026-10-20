import { AnimatePresence, motion } from 'framer-motion'
import { useSyncExternalStore } from 'react'
import { plural } from '../lib/plural'
import { spring } from '../lib/motion'
import { useOutboxSync } from './useOutboxSync'
import styles from './pwa.module.css'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}

/**
 * Плашка состояния сети и синхронизации: офлайн — сколько изменений ждёт отправки,
 * онлайн с непустой очередью — «синхронизация» до конца повтора.
 * Также владеет эффектом повтора очереди (useOutboxSync).
 */
export function OfflineBadge() {
  const pending = useOutboxSync()
  const online = useOnline()
  const visible = !online || pending > 0
  const text = !online
    ? pending > 0
      ? `Нет сети · ${pending} ${plural(pending, ['изменение ждёт', 'изменения ждут', 'изменений ждут'])}`
      : 'Нет сети · сохранённые данные'
    : 'Синхронизация изменений…'
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className={styles.offline}
          role="status"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={spring}
        >
          <i aria-hidden="true" /> {text}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
