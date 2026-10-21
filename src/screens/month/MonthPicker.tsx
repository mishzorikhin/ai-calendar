import { m } from 'framer-motion'
import { useLayoutEffect, useRef } from 'react'
import { BackIcon, ArrowRightIcon } from '../../components/Icons'
import { CircleButton, Pill } from '../../components/ui'
import { MONTHS } from '../../lib/dates'
import { ease } from '../../lib/motion'
import styles from './Month.module.css'

/** Горизонтальный ряд месяцев с шагом по годам по краям; при открытии центрируется на текущем. */
export function MonthPicker({
  month,
  year,
  onPick,
  onYear,
}: {
  month: number
  year: number
  onPick: (month: number) => void
  onYear: (delta: number) => void
}) {
  const row = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = row.current
    const active = el?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (el && active) el.scrollLeft = active.offsetLeft - el.clientWidth / 2 + active.clientWidth / 2
  }, [])

  return (
    <m.div
      className={styles.pickerWrap}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.32, ease }}
    >
      <div className={styles.picker}>
        <CircleButton
          tone="white"
          size={40}
          onClick={() => onYear(-1)}
          aria-label={`Предыдущий год (${year - 1})`}
          className={styles.pickerYear}
        >
          <BackIcon size={16} />
        </CircleButton>
        <div ref={row} className={`${styles.pickerMonths} scroll-x`}>
          {MONTHS.map((name, i) => (
            <Pill
              key={name}
              small
              tone={i === month ? 'dark' : 'white'}
              aria-pressed={i === month}
              onClick={() => onPick(i)}
            >
              {name}
            </Pill>
          ))}
        </div>
        <CircleButton
          tone="white"
          size={40}
          onClick={() => onYear(1)}
          aria-label={`Следующий год (${year + 1})`}
          className={styles.pickerYear}
        >
          <ArrowRightIcon size={16} />
        </CircleButton>
      </div>
    </m.div>
  )
}
