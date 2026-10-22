import { useState } from 'react'
import { apiErrorText } from '../../../api/api'
import { useDeleteAccount } from '../../../api/queries'
import { TrashIcon } from '../../../components/Icons'
import { Pill, Pressable } from '../../../components/ui'
import styles from './Account.module.css'

/**
 * Удаление аккаунта в два шага: открыть блок и ввести пароль, затем подтвердить ещё раз.
 * Совместные задачи, где человек участник, остаются у владельцев.
 */
export function DeleteAccount() {
  const remove = useDeleteAccount()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [sure, setSure] = useState(false)

  if (!open) {
    return (
      <Pressable className={styles.danger} onClick={() => setOpen(true)}>
        <TrashIcon size={17} /> Удалить аккаунт
      </Pressable>
    )
  }
  return (
    <form
      className={`${styles.form} ${styles.dangerBox}`}
      onSubmit={(e) => {
        e.preventDefault()
        if (!password) return
        if (!sure) {
          setSure(true)
          return
        }
        remove.mutate(password, { onError: () => setSure(false) })
      }}
    >
      <p className={styles.dangerTitle}>Удалить аккаунт навсегда?</p>
      <p className={styles.hint}>
        Пропадут события, задачи, чат, память ассистента и подключённые календари. Совместные задачи других людей
        останутся у них. Отменить это нельзя — сначала можно скачать свои данные.
      </p>
      <input
        className={styles.input}
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value)
          setSure(false)
        }}
        placeholder="Пароль для подтверждения"
        aria-label="Пароль для подтверждения удаления"
      />
      <div className={styles.row}>
        <Pill small tone="ghost" onClick={() => setOpen(false)}>
          Не удалять
        </Pill>
        <Pressable
          type="submit"
          className={`${styles.danger} ${styles.dangerSure}`}
          disabled={!password || remove.isPending}
          aria-label={sure ? 'Подтвердить удаление аккаунта' : 'Удалить аккаунт'}
        >
          <TrashIcon size={16} /> {remove.isPending ? 'Удаляю…' : sure ? 'Точно удалить?' : 'Удалить'}
        </Pressable>
      </div>
      {remove.error && (
        <p className={styles.error} role="alert">
          {apiErrorText(remove.error)}
        </p>
      )}
    </form>
  )
}
