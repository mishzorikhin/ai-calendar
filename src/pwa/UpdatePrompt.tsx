import { AnimatePresence, motion } from 'framer-motion'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Pill } from '../components/ui'
import { useTimeout } from '../lib/hooks'
import { spring } from '../lib/motion'
import styles from './pwa.module.css'

const UPDATE_CHECK_MS = 60 * 60 * 1000

/**
 * Регистрирует service worker и сообщает о новой версии.
 * Обновление применяется только по нажатию, чтобы не перезагрузить экран посреди действия.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Долгоживущее приложение на экране «Домой» раз в час проверяет обновления.
      if (registration) setInterval(() => void registration.update(), UPDATE_CHECK_MS)
    },
  })

  useTimeout(() => setOfflineReady(false), offlineReady ? 4000 : null)

  return (
    <AnimatePresence>
      {(needRefresh || offlineReady) && (
        <motion.div
          key={needRefresh ? 'update' : 'offline'}
          className={styles.toast}
          role="status"
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12 }}
          transition={spring}
        >
          {needRefresh ? (
            <>
              <span>Доступна новая версия</span>
              <Pill small tone="white" onClick={() => void updateServiceWorker(true)}>
                Обновить
              </Pill>
              <Pill small tone="dark" className={styles.dismiss} onClick={() => setNeedRefresh(false)}>
                Позже
              </Pill>
            </>
          ) : (
            <span>Приложение готово к работе без сети</span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
