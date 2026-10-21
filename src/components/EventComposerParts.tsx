import { AnimatePresence, m } from 'framer-motion'
import type { ReactNode } from 'react'
import { formatMinutes } from '../lib/dates'
import { spring } from '../lib/motion'
import { Pressable } from './ui'
import styles from './EventComposer.module.css'

/** Кнопка в строке подписи, которая открывает системный выбор даты или времени (невидимый input поверх). */
export function NativePicker({
  type,
  value,
  label,
  icon,
  children,
  onPick,
}: {
  type: 'date' | 'time'
  value: string
  label: string
  icon: ReactNode
  children: ReactNode
  onPick: (value: string) => void
}) {
  return (
    <label className={styles.pick}>
      {icon}
      {children}
      <input
        type={type}
        step={type === 'time' ? 300 : undefined}
        className={styles.pickInput}
        value={value}
        aria-label={label}
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value)
        }}
      />
    </label>
  )
}

/** Итог выбора над кнопкой «Создать»: время и пересечения, а при конфликте — сдвиг на ближайшее свободное. */
export function ComposerStatus({
  start,
  end,
  allDay,
  conflicts,
  shift,
  onShift,
}: {
  start: number
  end: number
  /** На весь день: время не занимает, пересечений нет. */
  allDay?: boolean
  conflicts: readonly string[]
  shift: number | null
  onShift: (start: number) => void
}) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      <m.div
        key={allDay ? 'all-day' : conflicts.join() || 'free'}
        className={`${styles.status} ${conflicts.length ? styles.warn : styles.ok}`}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={spring}
      >
        <p role="status">
          {allDay ? (
            'Весь день — время не занимает'
          ) : (
            <>
              <span className="tnum">
                {formatMinutes(start)}–{formatMinutes(end)}
              </span>
              {conflicts.length ? ` пересекается с: ${conflicts.join(', ')}` : ' — время свободно'}
            </>
          )}
        </p>
        {conflicts.length > 0 && shift !== null && (
          <Pressable
            className={`${styles.shift} tnum`}
            onClick={() => onShift(shift)}
            aria-label={`Сдвинуть на ${formatMinutes(shift)}`}
          >
            На {formatMinutes(shift)}
          </Pressable>
        )}
      </m.div>
    </AnimatePresence>
  )
}
