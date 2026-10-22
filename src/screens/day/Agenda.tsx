import { m } from 'framer-motion'
import { useCalendarName } from '../../api/queries'
import { DAY_PARTS, partOf } from '../../domain/calendar'
import type { CalendarEvent } from '../../domain/types'
import { formatMinutes } from '../../lib/dates'
import { BADGE_COLOR } from '../../lib/badges'
import { spring } from '../../lib/motion'
import { EventSub } from './EventCard'
import styles from './Day.module.css'

function AgendaSub({ event }: { event: CalendarEvent }) {
  return <EventSub event={event} calendar={useCalendarName(event.source)} />
}

/** Компактный список всех событий дня, сгруппированный по частям суток; тап открывает правку. */
export function Agenda({ events, onEvent }: { events: CalendarEvent[]; onEvent: (e: CalendarEvent) => void }) {
  const groups = DAY_PARTS.map((part) => ({
    part,
    items: events.filter((e) => partOf(e.start) === part.id),
  })).filter((g) => g.items.length > 0)

  let index = 0
  return (
    <div className={styles.agendaList}>
      {groups.map(({ part, items }) => (
        <section key={part.id} aria-label={part.title}>
          <p className={styles.agendaPart}>{part.title}</p>
          <ul className={styles.agendaItems}>
            {items.map((e) => (
              <m.li
                key={e.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...spring, delay: index++ * 0.04 }}
              >
                <button
                  type="button"
                  className={`${styles.agendaRow} ${e.highlight ? styles.eventNew : ''} ${e.invite?.status === 'pending' ? styles.invitePending : ''}`}
                  onClick={() => onEvent(e)}
                  aria-label={`${formatMinutes(e.start)}–${formatMinutes(e.end)}, ${e.title}`}
                >
                  <span className={`${styles.agendaTime} tnum`}>
                    {formatMinutes(e.start)}
                    <small>{formatMinutes(e.end)}</small>
                  </span>
                  <i style={{ background: BADGE_COLOR[e.badge] }} />
                  <span className={styles.agendaText}>
                    <span className={styles.eventTitle}>{e.title}</span>
                    <AgendaSub event={e} />
                  </span>
                </button>
              </m.li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
