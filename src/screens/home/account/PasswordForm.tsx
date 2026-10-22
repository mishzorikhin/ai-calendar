import { useState } from 'react'
import { apiErrorText } from '../../../api/api'
import { useChangePassword } from '../../../api/queries'
import { Pill } from '../../../components/ui'
import styles from './Account.module.css'

/** Смена пароля: после неё остальные устройства выходят из аккаунта. */
export function PasswordForm() {
  const change = useChangePassword()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const short = next.length > 0 && next.length < 6

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault()
        if (!current || next.length < 6) return
        change.mutate(
          { current, next },
          {
            onSuccess: () => {
              setCurrent('')
              setNext('')
            },
          },
        )
      }}
    >
      <input
        className={styles.input}
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        placeholder="Текущий пароль"
        aria-label="Текущий пароль"
      />
      <input
        className={styles.input}
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder="Новый пароль — от 6 символов"
        aria-label="Новый пароль"
        aria-invalid={short || undefined}
      />
      <Pill tone="dark" small type="submit" disabled={change.isPending || !current || next.length < 6}>
        {change.isPending ? 'Меняю…' : 'Сменить пароль'}
      </Pill>
      <p className={change.error ? styles.error : styles.hint} role="status">
        {change.error
          ? apiErrorText(change.error)
          : change.isSuccess
            ? 'Пароль сменён, на остальных устройствах выполнен выход'
            : 'После смены на остальных устройствах нужно будет войти заново'}
      </p>
    </form>
  )
}
