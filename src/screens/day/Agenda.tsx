import { motion } from 'framer-motion'
import { DAY_PARTS } from '../../domain/calendar'
import type { CalendarEvent } from '../../domain/types'
import { formatMinutes } from '../../lib/dates'
import { BADGE_COLOR } from '../../lib/badges'
import { spring } from '../../lib/motion'
import styles from './Day.module.css'

/** Компактный список всех событий дня, сгруппированный по частям суток. */
export function Agenda({ events }: { events: CalendarEvent[] }) {
  const groups = DAY_PARTS.map((part) => ({
    part,
    items: events.filter((e) => e.start >= part.from && e.start < part.to),
  })).filter((g) => g.items.length > 0)

  let index = 0
  return (
    <div className={styles.agendaList}>
      {groups.map(({ part, items }) => (
        <section key={part.id} aria-label={part.title}>
          <p className={styles.agendaPart}>{part.title}</p>
          <ul className={styles.agendaItems}>
            {items.map((e) => (
              <motion.li
                key={e.id}
                className={`${styles.agendaRow} ${e.highlight ? styles.eventNew : ''}`}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...spring, delay: index++ * 0.04 }}
              >
                <span className={`${styles.agendaTime} tnum`}>
                  {formatMinutes(e.start)}
                  <small>{formatMinutes(e.end)}</small>
                </span>
                <i style={{ background: BADGE_COLOR[e.badge] }} />
                <span className={styles.agendaText}>
                  <span className={styles.eventTitle}>{e.title}</span>
                  {e.subtitle && <span className={styles.eventSub}>{e.subtitle}</span>}
                </span>
              </motion.li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
