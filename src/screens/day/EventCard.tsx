import { m } from 'framer-motion'
import { useCalendarName } from '../../api/queries'
import { BADGE_ICON, CarIcon, RepeatIcon, VideoIcon } from '../../components/Icons'
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
  const invite = event.invite && `от ${event.invite.from.name || '@' + event.invite.from.username}`
  const text = event.subtitle || invite || calendar
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
  // Дорога — пунктирная полоса над карточкой: это время тоже занято.
  const travelFrom = Math.max(event.start - (event.travel ?? 0), from)
  const travelH = ((event.start - travelFrom) / 60) * HOUR_H
  return (
    <>
      {travelH >= 12 && (
        <m.span
          className={styles.travel}
          style={{ top: ((travelFrom - from) / 60) * HOUR_H + 2, height: travelH - 2 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 + index * 0.06 }}
          aria-hidden="true"
        >
          {travelH >= 22 && (
            <>
              <CarIcon size={12} /> в пути {event.travel} мин
            </>
          )}
        </m.span>
      )}
      <m.button
        data-event
        type="button"
        className={`${styles.event} ${event.highlight ? styles.eventNew : ''} ${event.invite ? styles.invite : ''} ${event.invite?.status === 'pending' ? styles.invitePending : ''}`}
        style={{ top, height }}
        initial={{ opacity: 0, y: 14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ ...spring, delay: 0.15 + index * 0.06 }}
        aria-label={`${formatMinutes(event.start)}–${formatMinutes(event.end)}, ${event.title}${event.repeat ? ', повторяется' : ''}${event.travel ? `, дорога ${event.travel} минут` : ''}${event.invite ? `, приглашение от @${event.invite.from.username}` : ''}${calendar ? `, календарь «${calendar}»` : ''}`}
        onClick={() => onOpen(event)}
        whileTap={{ scale: 0.97 }}
      >
        <span className={styles.eventTitle}>
          {event.repeat && <RepeatIcon size={12} strokeWidth={2.2} className={styles.repeatMark} />}
          {event.url && <VideoIcon size={12} strokeWidth={2.2} className={styles.repeatMark} />}
          {event.title}
        </span>
        <EventSub event={event} calendar={calendar} />
        <i className={styles.badge} style={{ background: BADGE_COLOR[event.badge] }}>
          <BadgeIcon size={10} strokeWidth={2.4} />
        </i>
        {event.highlight && <span className={styles.newTag}>Новое</span>}
        {event.invite?.status === 'pending' && <span className={styles.newTag}>Приглашение</span>}
      </m.button>
    </>
  )
}
