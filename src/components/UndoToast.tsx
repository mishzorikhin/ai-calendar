import { AnimatePresence, m } from 'framer-motion'
import { useUndo } from '../app/undo'
import { useTimeout } from '../lib/hooks'
import { spring } from '../lib/motion'
import { UndoIcon } from './Icons'
import { Pressable } from './ui'
import styles from './UndoToast.module.css'

/** Сколько секунд можно передумать. */
const UNDO_MS = 5000

/** Плашка «Удалено · Отменить» над нижней панелью. Новая заменяет прежнюю, через 5 секунд исчезает. */
export function UndoToast() {
  const { item, dismiss } = useUndo()
  useTimeout(dismiss, item ? UNDO_MS : null, item?.id)
  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <AnimatePresence>
        {item && (
          <m.div
            key={item.id}
            className={styles.toast}
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={spring}
          >
            <span>{item.text}</span>
            <Pressable
              className={styles.undo}
              onClick={() => {
                item.undo()
                dismiss()
              }}
            >
              <UndoIcon size={16} /> Отменить
            </Pressable>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}
