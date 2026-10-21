import { useCalendarName } from '../api/queries'
import type { DatedEvent } from '../domain/types'
import { formatMinutes, relativeDayLabel } from '../lib/dates'
import { BottomSheet } from './BottomSheet'
import { CloseIcon, LockIcon } from './Icons'
import { CircleButton, Pill } from './ui'
import styles from './EventComposer.module.css'

/** Событие из подключённого календаря, которое здесь не изменить: подписка, повтор серии, на весь день. */
export function ReadOnlyEvent({ event, onClose }: { event: DatedEvent; onClose: () => void }) {
  const calendar = useCalendarName(event.source)
  const when = event.allDay
    ? `${relativeDayLabel(event.date)}, весь день`
    : `${relativeDayLabel(event.date)}, ${formatMinutes(event.start)}–${formatMinutes(event.end)}`
  return (
    <BottomSheet
      label={event.title}
      onClose={onClose}
      footer={
        <div className={styles.actions}>
          <Pill tone="dark" className={styles.create} onClick={onClose}>
            Понятно
          </Pill>
        </div>
      }
    >
      <div className={styles.head}>
        <h2>{event.title}</h2>
        <CircleButton tone="gray" size={44} onClick={onClose} aria-label="Закрыть">
          <CloseIcon size={18} />
        </CircleButton>
      </div>
      <p className={`${styles.readOnlyWhen} tnum`}>{when}</p>
      {event.subtitle && <p className={styles.readOnlySub}>{event.subtitle}</p>}
      <p className={`${styles.status} ${styles.readOnlyNote}`}>
        <LockIcon size={15} />
        <span>
          Из календаря «{calendar ?? 'подключённый календарь'}». Изменить или удалить его можно только там — здесь
          изменения появятся сами.
        </span>
      </p>
    </BottomSheet>
  )
}
