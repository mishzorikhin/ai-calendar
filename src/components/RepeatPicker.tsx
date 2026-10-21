import { REPEAT_OPTIONS } from '../domain/repeat'
import type { Repeat } from '../domain/types'
import { Pill } from './ui'
import styles from './EventComposer.module.css'

/** Лента «Повтор» в шторке события: '' — не повторять. */
export function RepeatPicker({ value, onChange }: { value: Repeat | ''; onChange: (r: Repeat | '') => void }) {
  return (
    <>
      <p className={styles.label} id="composer-repeat">
        Повтор
      </p>
      <div className={`${styles.row} scroll-x`} role="group" aria-labelledby="composer-repeat">
        <Pill small tone={value === '' ? 'dark' : 'ghost'} aria-pressed={value === ''} onClick={() => onChange('')}>
          Нет
        </Pill>
        {REPEAT_OPTIONS.map(({ id, label }) => (
          <Pill
            key={id}
            small
            tone={id === value ? 'dark' : 'ghost'}
            aria-pressed={id === value}
            onClick={() => onChange(id)}
          >
            {label}
          </Pill>
        ))}
      </div>
    </>
  )
}
