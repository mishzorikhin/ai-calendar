import { AnimatePresence, m } from 'framer-motion'
import type { CalendarEvent } from '../../domain/types'
import { BADGE_COLOR } from '../../lib/badges'
import { spring } from '../../lib/motion'
import styles from './Day.module.css'

/** События на весь день (праздники, дни рождения, отпуск) — полосой над шкалой. */
export function AllDayStrip({ events, onOpen }: { events: CalendarEvent[]; onOpen: (e: CalendarEvent) => void }) {
  return (
    <AnimatePresence initial={false}>
      {events.length > 0 && (
        <m.ul
          key="all-day"
          className={`${styles.allDay} scroll-x`}
          aria-label="Весь день"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={spring}
        >
          {events.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className={styles.allDayChip}
                onClick={() => onOpen(e)}
                aria-label={`Весь день: ${e.title}`}
              >
                <i style={{ background: BADGE_COLOR[e.badge] }} />
                {e.title}
              </button>
            </li>
          ))}
        </m.ul>
      )}
    </AnimatePresence>
  )
}
