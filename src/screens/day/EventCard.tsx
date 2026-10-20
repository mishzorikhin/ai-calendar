import { motion } from 'framer-motion'
import { BADGE_ICON } from '../../components/Icons'
import type { CalendarEvent } from '../../domain/types'
import { formatMinutes } from '../../lib/dates'
import { BADGE_COLOR } from '../../lib/badges'
import { spring } from '../../lib/motion'
import styles from './Day.module.css'

/** Высота часа на шкале, px. */
export const HOUR_H = 62
const MIN_CARD_H = 44

/** Карточка события на шкале; тап открывает редактирование. Событие, выходящее за границу части суток, обрезается по ней. */
export function EventCard({
  event,
  from,
  to,
  index,
  onOpen,
}: {
  event: CalendarEvent
  from: number
  to: number
  index: number
  onOpen: (event: CalendarEvent) => void
}) {
  const BadgeIcon = BADGE_ICON[event.badge]
  const end = Math.min(event.end, to)
  const top = ((event.start - from) / 60) * HOUR_H + 3
  const height = Math.max(((end - event.start) / 60) * HOUR_H - 6, MIN_CARD_H)
  return (
    <motion.button
      data-event
      type="button"
      className={`${styles.event} ${event.highlight ? styles.eventNew : ''}`}
      style={{ top, height }}
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...spring, delay: 0.15 + index * 0.06 }}
      aria-label={`${formatMinutes(event.start)}–${formatMinutes(event.end)}, ${event.title}`}
      onClick={() => onOpen(event)}
      whileTap={{ scale: 0.97 }}
    >
      <span className={styles.eventTitle}>{event.title}</span>
      {event.subtitle && <span className={styles.eventSub}>{event.subtitle}</span>}
      <i className={styles.badge} style={{ background: BADGE_COLOR[event.badge] }}>
        <BadgeIcon size={10} strokeWidth={2.4} />
      </i>
      {event.highlight && <span className={styles.newTag}>Новое</span>}
    </motion.button>
  )
}
