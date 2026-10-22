import { m } from 'framer-motion'
import { useId } from 'react'
import { spring } from '../lib/motion'
import styles from './Segmented.module.css'

export type SegmentedOption<T extends string> = { id: T; label: string }

/**
 * Переключатель из нескольких вариантов (radiogroup): выбранный подсвечен «ползунком».
 * Стрелки влево/вправо переключают варианты, как у нативной группы радиокнопок.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  /** Подпись группы для экранного диктора. */
  label: string
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
}) {
  const knob = useId()
  /** Стрелка: выбрать соседний вариант и перевести на него фокус. */
  const move = (from: HTMLElement, dir: 1 | -1) => {
    const i = (options.findIndex((o) => o.id === value) + dir + options.length) % options.length
    const next = options[i]
    if (!next) return
    onChange(next.id)
    from.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]')[i]?.focus()
  }
  return (
    <div className={styles.group} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={styles.option}
            onClick={() => onChange(o.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(e.currentTarget, 1)
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(e.currentTarget, -1)
              else return
              e.preventDefault()
            }}
          >
            {on && <m.i layoutId={knob} className={styles.knob} transition={spring} style={{ borderRadius: 14 }} />}
            <span className={styles.text}>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
