import { usePush } from '../api/queries'
import { DEFAULT_NOTIFY_SETTINGS, REMINDER_PRESETS, reminderShortLabel } from '../domain/reminders'
import { Pill } from './ui'
import styles from './EventComposer.module.css'

/** Варианты: «нет» (−1), в момент начала (0) и минуты до начала. */
const CHOICES = [-1, ...REMINDER_PRESETS]

/**
 * Выбранный вариант для напоминаний события: null — как в настройках (fallback), [] — «нет»,
 * иначе первое (самое раннее) напоминание.
 */
export function reminderValue(reminders: readonly number[] | null | undefined, fallback: number): number {
  if (reminders == null) return fallback
  return reminders[0] ?? -1
}

/** Лента «Напомнить» в шторке события. value — минуты до начала, −1 — не напоминать. */
export function ReminderPicker({
  value,
  isDefault,
  onChange,
  disabled,
}: {
  value: number
  /** Значение взято из настроек, а не задано у события. */
  isDefault: boolean
  onChange: (minutes: number) => void
  disabled?: boolean
}) {
  const options = CHOICES.includes(value) ? CHOICES : [...CHOICES, value].sort((a, b) => a - b)
  return (
    <>
      <div className={styles.labelRow}>
        <p className={styles.label} id="composer-reminder">
          Напомнить
        </p>
        {isDefault && <span className={styles.labelNote}>как в настройках</span>}
      </div>
      <div className={`${styles.row} scroll-x`} role="group" aria-labelledby="composer-reminder">
        {options.map((m) => (
          <Pill
            key={m}
            small
            tone={m === value ? 'dark' : 'ghost'}
            aria-pressed={m === value}
            disabled={disabled}
            onClick={() => m !== value && onChange(m)}
          >
            {reminderShortLabel(m)}
          </Pill>
        ))}
      </div>
    </>
  )
}

/** Напоминание по умолчанию из настроек аккаунта. */
export function useDefaultReminder(): number {
  const { data } = usePush()
  return (data?.settings ?? DEFAULT_NOTIFY_SETTINGS).eventReminder
}
