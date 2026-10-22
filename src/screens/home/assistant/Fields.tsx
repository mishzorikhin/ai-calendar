import { useId, type ReactNode } from 'react'
import { Pill } from '../../../components/ui'
import { SHORT_WEEKDAYS, WEEK_ORDER } from '../../../domain/profile'
import { formatMinutes, parseMinutes } from '../../../lib/dates'
import styles from './Assistant.module.css'

/** Время суток «таблеткой»: по нажатию — системный выбор времени поверх неё. */
export function TimePill({
  label,
  value,
  onChange,
}: {
  /** Подпись для экранного диктора: «Подъём». */
  label: string
  value: number
  onChange: (minutes: number) => void
}) {
  // 24:00 (конец суток) системный выбор не понимает — показываем и отдаём как 00:00.
  const shown = formatMinutes(value % 1440)
  return (
    <span className={styles.timePill}>
      <span className="tnum">{shown}</span>
      <input
        type="time"
        aria-label={`${label}: ${shown}`}
        value={shown}
        step={300}
        onChange={(e) => {
          const m = parseMinutes(e.target.value)
          if (m !== null) onChange(m)
        }}
      />
    </span>
  )
}

/** Дни недели переключателями: пн…вс. */
export function DayPicker({
  label,
  days,
  onChange,
}: {
  label: string
  days: readonly number[]
  onChange: (days: number[]) => void
}) {
  return (
    <div className={styles.days} role="group" aria-label={label}>
      {WEEK_ORDER.map((d) => {
        const on = days.includes(d)
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            className={`${styles.day} ${on ? styles.dayOn : ''} ${d === 0 || d === 6 ? styles.dayWeekend : ''}`}
            onClick={() => onChange(on ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b))}
          >
            {SHORT_WEEKDAYS[d]}
          </button>
        )
      })}
    </div>
  )
}

/** Выбор одного варианта «таблетками» (radiogroup) — как в настройках напоминаний. */
export function PillChoice<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { id: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className={styles.choices} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <Pill
          key={String(o.id)}
          small
          role="radio"
          aria-checked={o.id === value}
          tone={o.id === value ? 'dark' : 'white'}
          className={styles.choice}
          onClick={() => o.id !== value && onChange(o.id)}
        >
          {o.label}
        </Pill>
      ))}
    </div>
  )
}

/** Подложка группы настроек с заголовком и подсказкой. */
export function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className={styles.group} aria-labelledby={id}>
      <h3 className={styles.groupTitle} id={id}>
        {title}
      </h3>
      {hint && <p className={styles.groupHint}>{hint}</p>}
      {children}
    </section>
  )
}

/** Переключатель «вкл/выкл» строкой (role="switch"). */
export function SwitchRow({
  label,
  hint,
  on,
  onChange,
}: {
  label: string
  hint?: string
  on: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <button type="button" role="switch" aria-checked={on} className={styles.switchRow} onClick={() => onChange(!on)}>
      <span className={styles.switchText}>
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <i className={`${styles.switch} ${on ? styles.switchOn : ''}`} aria-hidden="true" />
    </button>
  )
}
