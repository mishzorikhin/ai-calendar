import { AnimatePresence, motion } from 'framer-motion'
import { useSyncExternalStore } from 'react'
import { spring } from '../lib/motion'
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

/** Плашка «нет сети»: данные показываются из кэша, изменения отправятся после подключения. */
export function OfflineBadge() {
  const online = useOnline()
  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          className={styles.offline}
          role="status"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={spring}
        >
          <i aria-hidden="true" /> Нет сети · сохранённые данные
        </motion.div>
      )}
    </AnimatePresence>
  )
}
