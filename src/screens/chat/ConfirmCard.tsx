import { m } from 'framer-motion'
import { apiErrorText, type ChatConfirm } from '../../api/api'
import { useDecideChatConfirm } from '../../api/queries'
import { Pill } from '../../components/ui'
import { spring } from '../../lib/motion'
import styles from './Chat.module.css'

/**
 * Карточка подтверждения под ответом ассистента. Удаление, перенос нескольких событий
 * и освобождение дня выполняет только кнопка — слова в чате их не запускают.
 * disabled — ответ ещё пишется: нажать можно, когда он закончится.
 */
export function ConfirmCard({ confirm, disabled }: { confirm: ChatConfirm; disabled?: boolean }) {
  const decide = useDecideChatConfirm()
  const busy = disabled || decide.isPending
  const answer = (accept: boolean) => decide.mutate({ id: confirm.id, accept })
  return (
    <m.div
      className={styles.confirm}
      role="group"
      aria-label={confirm.title}
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
      style={{ originX: 0, originY: 1 }}
    >
      <p className={styles.confirmTitle}>{confirm.title}</p>
      {confirm.detail && <p className={styles.confirmDetail}>{confirm.detail}</p>}
      {decide.isError && (
        <p className={styles.confirmError} role="status">
          {apiErrorText(decide.error)}
        </p>
      )}
      <div className={styles.confirmActions}>
        <Pill small tone="dark" disabled={busy} onClick={() => answer(true)}>
          {confirm.button}
        </Pill>
        <Pill small tone="ghost" disabled={busy} onClick={() => answer(false)}>
          Не надо
        </Pill>
      </div>
    </m.div>
  )
}
