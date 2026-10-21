import { useId } from 'react'
import { Pill } from '../../../components/ui'
import styles from './Reminders.module.css'

type Props = {
  title: string
  hint?: string
  options: readonly number[]
  value: number
  label: (v: number) => string
  onChange: (v: number) => void
}

/** Группа вариантов одной настройки — переключатели-«таблетки» в ряд (radiogroup). */
export function ChoiceRow({ title, hint, options, value, label, onChange }: Props) {
  const id = useId()
  // Значение не из списка (задано ассистентом или с другого устройства) тоже показываем выбранным.
  const list = options.includes(value) ? options : [...options, value].sort((a, b) => a - b)
  return (
    <div className={styles.group}>
      <p className={styles.groupTitle} id={`${id}-title`}>
        {title}
      </p>
      {hint && <p className={styles.groupHint}>{hint}</p>}
      <div className={styles.choices} role="radiogroup" aria-labelledby={`${id}-title`}>
        {list.map((v) => (
          <Pill
            key={v}
            small
            role="radio"
            aria-checked={v === value}
            tone={v === value ? 'dark' : 'white'}
            className={styles.choice}
            onClick={() => v !== value && onChange(v)}
          >
            {label(v)}
          </Pill>
        ))}
      </div>
    </div>
  )
}
