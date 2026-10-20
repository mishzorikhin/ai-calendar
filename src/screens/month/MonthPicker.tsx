import { motion } from 'framer-motion'
import { useLayoutEffect, useRef } from 'react'
import { Pill } from '../../components/ui'
import { MONTHS } from '../../lib/dates'
import { ease } from '../../lib/motion'
import styles from './Month.module.css'

/** Горизонтальный ряд месяцев; при открытии центрируется на текущем. */
export function MonthPicker({ month, onPick }: { month: number; onPick: (month: number) => void }) {
  const row = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = row.current
    const active = el?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (el && active) el.scrollLeft = active.offsetLeft - el.clientWidth / 2 + active.clientWidth / 2
  }, [])

  return (
    <motion.div
      className={styles.pickerWrap}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.32, ease }}
    >
      <div ref={row} className={`${styles.picker} scroll-x`}>
        {MONTHS.map((m, i) => (
          <Pill
            key={m}
            small
            tone={i === month ? 'dark' : 'white'}
            aria-pressed={i === month}
            onClick={() => onPick(i)}
          >
            {m}
          </Pill>
        ))}
      </div>
    </motion.div>
  )
}
