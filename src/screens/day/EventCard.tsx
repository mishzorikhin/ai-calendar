import { m } from 'framer-motion'
import { useCalendarName } from '../../api/queries'
import { BADGE_ICON, RepeatIcon } from '../../components/Icons'
import type { CalendarEvent } from '../../domain/types'
import { formatMinutes } from '../../lib/dates'
import { BADGE_COLOR } from '../../lib/badges'
import { spring } from '../../lib/motion'
import styles from './Day.module.css'

/** Высота часа на шкале, px. */
export const HOUR_H = 62
const MIN_CARD_H = 44

/** Подзаголовок события: место/заметка, а у событий без заметки — откуда они (Google, Яндекс…). */
export function EventSub({ event, calendar }: { event: CalendarEvent; calendar: string | undefined }) {
  const text = event.subtitle || calendar
  return text ? <span className={styles.eventSub}>{text}</span> : null
}

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
  const calendar = useCalendarName(event.source)
  const end = Math.min(event.end, to)
  const top = ((event.start - from) / 60) * HOUR_H + 3
  const height = Math.max(((end - event.start) / 60) * HOUR_H - 6, MIN_CARD_H)
  return (
    <m.button
      data-event
      type="button"
      className={`${styles.event} ${event.highlight ? styles.eventNew : ''}`}
      style={{ top, height }}
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...spring, delay: 0.15 + index * 0.06 }}
      aria-label={`${formatMinutes(event.start)}–${formatMinutes(event.end)}, ${event.title}${event.repeat ? ', повторяется' : ''}${calendar ? `, календарь «${calendar}»` : ''}`}
      onClick={() => onOpen(event)}
      whileTap={{ scale: 0.97 }}
    >
      <span className={styles.eventTitle}>
        {event.repeat && <RepeatIcon size={12} strokeWidth={2.2} className={styles.repeatMark} />}
        {event.title}
      </span>
      <EventSub event={event} calendar={calendar} />
      <i className={styles.badge} style={{ background: BADGE_COLOR[event.badge] }}>
        <BadgeIcon size={10} strokeWidth={2.4} />
      </i>
      {event.highlight && <span className={styles.newTag}>Новое</span>}
    </m.button>
  )
}
