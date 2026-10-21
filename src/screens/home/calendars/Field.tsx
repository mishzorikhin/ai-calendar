import type { InputHTMLAttributes } from 'react'
import styles from './Calendars.module.css'

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'className'> & {
  id: string
  label: string
  onValue: (value: string) => void
  /** Адреса и логины: без автокоррекции и заглавной буквы. */
  plain?: boolean
}

/** Подпись и поле ввода формы подключения календаря. */
export function Field({ id, label, onValue, plain, ...input }: FieldProps) {
  const plainProps = plain ? { autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false } : null
  return (
    <>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
      </label>
      <input id={id} className={styles.input} onChange={(e) => onValue(e.target.value)} {...plainProps} {...input} />
    </>
  )
}
