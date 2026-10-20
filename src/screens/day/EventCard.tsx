import { motion } from 'framer-motion'
import { BADGE_ICON } from '../../components/Icons'
import type { CalendarEvent } from '../../domain/types'
import { formatMinutes } from '../../lib/dates'
import { BADGE_COLOR } from '../../lib/badges'
import { ease, spring } from '../../lib/motion'
import styles from './Day.module.css'

/** Высота часа на шкале, px. */
export const HOUR_H = 62
const MIN_CARD_H = 44

/** Карточка события на шкале. Событие, выходящее за границу части суток, обрезается по ней. */
export function EventCard({
  event,
  from,
  to,
  index,
}: {
  event: CalendarEvent
  from: number
  to: number
  index: number
}) {
  const BadgeIcon = BADGE_ICON[event.badge]
  const end = Math.min(event.end, to)
  const top = ((event.start - from) / 60) * HOUR_H + 3
  const height = Math.max(((end - event.start) / 60) * HOUR_H - 6, MIN_CARD_H)
  return (
    <motion.div
      data-event
      className={`${styles.event} ${event.highlight ? styles.eventNew : ''}`}
      style={{ top, height }}
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...spring, delay: 0.15 + index * 0.06 }}
      aria-label={`${formatMinutes(event.start)}–${formatMinutes(event.end)}, ${event.title}`}
      role="group"
    >
      <span className={styles.eventTitle}>{event.title}</span>
      {event.subtitle && <span className={styles.eventSub}>{event.subtitle}</span>}
      <i className={styles.badge} style={{ background: BADGE_COLOR[event.badge] }}>
        <BadgeIcon size={10} strokeWidth={2.4} />
      </i>
      {event.sleepGraph && <SleepGraph />}
      {event.highlight && <span className={styles.newTag}>Новое</span>}
    </motion.div>
  )
}

// Детерминированная «запись сна» — одинаковая при каждом рендере.
const SLEEP_BARS = Array.from({ length: 64 }, (_, i) => {
  const wave = Math.sin(i / 5) * 0.35 + Math.sin(i / 2.3) * 0.2
  return Math.min(0.25 + Math.abs(wave) + ((i * 7919) % 13) / 60, 1)
})

function SleepGraph() {
  return (
    <span className={styles.sleep} aria-hidden="true">
      {SLEEP_BARS.map((h, i) => (
        <motion.i
          key={i}
          initial={{ scaleY: 0 }}
          animate={{ scaleY: h }}
          transition={{ duration: 0.5, delay: 0.3 + i * 0.008, ease }}
        />
      ))}
    </span>
  )
}
