import { useState } from 'react'
import { apiErrorText } from '../api/api'
import { useApi } from '../api/provider'
import { useCalendarName, useRsvp, useUpdateEvent } from '../api/queries'
import type { DatedEvent, Rsvp } from '../domain/types'
import { formatMinutes, relativeDayLabel } from '../lib/dates'
import { BottomSheet } from './BottomSheet'
import { EventLinks } from './EventLinks'
import { CheckIcon, CloseIcon, LockIcon, UsersIcon } from './Icons'
import { ReminderPicker, reminderValue, useDefaultReminder } from './ReminderPicker'
import { CircleButton, Pill } from './ui'
import styles from './EventComposer.module.css'

/**
 * Событие, которое здесь не изменить: из подключённого календаря (подписка, повтор серии, на весь день)
 * или чужая встреча, куда пригласили, — у неё вместо замка кнопки «Приду» / «Не приду».
 */
export function ReadOnlyEvent({ event, onClose }: { event: DatedEvent; onClose: () => void }) {
  const calendar = useCalendarName(event.source)
  const update = useUpdateEvent()
  // Напоминание — настройка приложения: его можно задать и событию, которое здесь не изменить.
  // Напоминание о приглашении — по своим настройкам: чужое событие менять нельзя.
  const remindersOn = useApi().mode === 'server' && !event.allDay && !event.invite
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
      {event.invite ? (
        <InviteAnswer event={event} onDone={onClose} />
      ) : (
        <p className={`${styles.status} ${styles.readOnlyNote}`}>
          <LockIcon size={15} />
          <span>
            Из календаря «{calendar ?? 'подключённый календарь'}». Изменить или удалить его можно только там — здесь
            изменения появятся сами.
          </span>
        </p>
      )}
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

const ANSWER: Record<Rsvp, string> = {
  pending: 'Вы ещё не ответили',
  accepted: 'Вы придёте',
  declined: 'Вы не придёте',
}

/** Приглашение: от кого, мой ответ и кнопки ответа. Отказ закрывает шторку — встреча уходит из дня. */
function InviteAnswer({ event, onDone }: { event: DatedEvent; onDone: () => void }) {
  const rsvp = useRsvp()
  const invite = event.invite
  const [status, setStatus] = useState<Rsvp>(invite?.status ?? 'pending')
  if (!invite) return null
  const answer = (next: Rsvp) => {
    setStatus(next)
    rsvp.mutate(
      { event, status: next },
      { onSuccess: () => next === 'declined' && onDone(), onError: () => setStatus(invite.status) },
    )
  }
  const who = invite.from.name || `@${invite.from.username}`
  return (
    <>
      <p className={`${styles.status} ${styles.readOnlyNote}`}>
        <UsersIcon size={15} />
        <span>
          Приглашение от {who}. {ANSWER[status]}.
        </span>
      </p>
      <div className={styles.rsvp} role="group" aria-label="Ответ на приглашение">
        <Pill
          tone={status === 'accepted' ? 'dark' : 'ghost'}
          aria-pressed={status === 'accepted'}
          disabled={rsvp.isPending}
          onClick={() => answer('accepted')}
        >
          <CheckIcon size={16} /> Приду
        </Pill>
        <Pill
          tone={status === 'declined' ? 'dark' : 'ghost'}
          aria-pressed={status === 'declined'}
          disabled={rsvp.isPending}
          onClick={() => answer('declined')}
        >
          <CloseIcon size={16} /> Не приду
        </Pill>
      </div>
      {rsvp.error && (
        <p className={styles.error} role="alert">
          {apiErrorText(rsvp.error)}
        </p>
      )}
    </>
  )
}
