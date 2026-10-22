import { useState } from 'react'
import { apiErrorText } from '../api/api'
import { useApi } from '../api/provider'
import { useCalendarName, useUpdateEvent } from '../api/queries'
import type { DatedEvent } from '../domain/types'
import { formatMinutes, relativeDayLabel } from '../lib/dates'
import { BottomSheet } from './BottomSheet'
import { EventLinks } from './EventLinks'
import { CloseIcon, LockIcon } from './Icons'
import { ReminderPicker, reminderValue, useDefaultReminder } from './ReminderPicker'
import { CircleButton, Pill } from './ui'
import styles from './EventComposer.module.css'

/** Событие из подключённого календаря, которое здесь не изменить: подписка, повтор серии, на весь день. */
export function ReadOnlyEvent({ event, onClose }: { event: DatedEvent; onClose: () => void }) {
  const calendar = useCalendarName(event.source)
  const update = useUpdateEvent()
  // Напоминание — настройка приложения: его можно задать и событию, которое здесь не изменить.
  const remindersOn = useApi().mode === 'server' && !event.allDay
  const defaultReminder = useDefaultReminder(event.badge)
  const [reminders, setReminders] = useState(event.reminders)
  const pickReminder = (minutes: number) => {
    const next = minutes < 0 ? [] : [minutes]
    setReminders(next)
    update.mutate({ event, patch: { reminders: next } }, { onError: () => setReminders(event.reminders) })
  }
  const when = event.allDay
    ? `${relativeDayLabel(event.date)}, весь день`
    : `${relativeDayLabel(event.date)}, ${formatMinutes(event.start)}–${formatMinutes(event.end)}`
  const travel = event.travel ? ` · дорога ${event.travel} мин` : ''
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
      <p className={`${styles.readOnlyWhen} tnum`}>
        {when}
        {travel}
      </p>
      {event.subtitle && <p className={styles.readOnlySub}>{event.subtitle}</p>}
      <EventLinks event={event} />
      <p className={`${styles.status} ${styles.readOnlyNote}`}>
        <LockIcon size={15} />
        <span>
          Из календаря «{calendar ?? 'подключённый календарь'}». Изменить или удалить его можно только там — здесь
          изменения появятся сами.
        </span>
      </p>
      {remindersOn && (
        <ReminderPicker
          value={reminderValue(reminders, defaultReminder)}
          isDefault={reminders == null}
          onChange={pickReminder}
        />
      )}
      {update.error && (
        <p className={styles.error} role="alert">
          {apiErrorText(update.error)}
        </p>
      )}
    </BottomSheet>
  )
}
