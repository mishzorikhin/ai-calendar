import { useState } from 'react'
import { apiErrorText } from '../../../api/api'
import { useSearch } from '../../../api/queries'
import { BottomSheet } from '../../../components/BottomSheet'
import { CheckIcon, CloseIcon, SearchIcon } from '../../../components/Icons'
import { CircleButton, Pressable } from '../../../components/ui'
import type { DatedEvent, Task } from '../../../domain/types'
import { BADGE_COLOR } from '../../../lib/badges'
import { formatMinutes, relativeDayLabel, startOfDay } from '../../../lib/dates'
import styles from './Search.module.css'

/** Поиск по событиям (название, место, заметки) и задачам: событие открывает свой день, задача — шторку. */
export function SearchSheet({
  onClose,
  onDay,
  onTask,
}: {
  onClose: () => void
  onDay: (date: Date) => void
  onTask: (task: Task) => void
}) {
  const [query, setQuery] = useState('')
  const { result, isFetching, error } = useSearch(query)
  const short = [...query.trim()].length < 2
  const today = startOfDay(new Date())
  const upcoming = result.events.filter((e) => e.date >= today)
  const past = result.events.filter((e) => e.date < today)
  const empty = !short && !isFetching && result.events.length + result.tasks.length === 0

  return (
    <BottomSheet label="Поиск" onClose={onClose} maxHeight="92%">
      <div className={styles.bar}>
        <label className={styles.field}>
          <SearchIcon size={18} />
          <input
            className={styles.input}
            value={query}
            ref={(el) => el?.focus({ preventScroll: true })}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Встреча, место, задача"
            aria-label="Что найти"
            enterKeyHint="search"
            type="search"
          />
        </label>
        <CircleButton tone="gray" size={44} onClick={onClose} aria-label="Закрыть">
          <CloseIcon size={18} />
        </CircleButton>
      </div>

      <div role="status" aria-live="polite" className={styles.state}>
        {short
          ? 'Ищите по названию, месту и заметкам событий и по задачам'
          : error
            ? apiErrorText(error)
            : empty
              ? 'Ничего не нашлось'
              : ''}
      </div>

      <EventGroup title="Предстоящие" events={upcoming} today={today} onDay={onDay} />
      <EventGroup title="Прошедшие" events={past} today={today} onDay={onDay} />
      {result.tasks.length > 0 && (
        <section aria-label="Задачи">
          <p className={styles.label}>Задачи и цели</p>
          <ul className={styles.list}>
            {result.tasks.map((t) => (
              <li key={t.id}>
                <Pressable className={styles.row} scale={0.98} onClick={() => onTask(t)}>
                  <span className={`${styles.check} ${t.done ? styles.checkOn : ''}`} aria-hidden="true">
                    {t.done && <CheckIcon size={13} strokeWidth={2.6} />}
                  </span>
                  <span className={styles.text}>
                    <span className={`${styles.title} ${t.done ? styles.done : ''}`}>{t.title}</span>
                    {(t.subtitle || t.due) && (
                      <span className={styles.sub}>
                        {[t.subtitle, t.due && `срок ${t.due.split('-').reverse().slice(0, 2).join('.')}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                  </span>
                </Pressable>
              </li>
            ))}
          </ul>
        </section>
      )}
    </BottomSheet>
  )
}

function EventGroup({
  title,
  events,
  today,
  onDay,
}: {
  title: string
  events: DatedEvent[]
  today: Date
  onDay: (date: Date) => void
}) {
  if (events.length === 0) return null
  return (
    <section aria-label={title}>
      <p className={styles.label}>{title}</p>
      <ul className={styles.list}>
        {events.map((e) => (
          <li key={`${e.id}-${e.date.getTime()}`}>
            <Pressable
              className={styles.row}
              scale={0.98}
              onClick={() => onDay(e.date)}
              aria-label={`${relativeDayLabel(e.date, today)}, ${e.allDay ? 'весь день' : formatMinutes(e.start)}: ${e.title}`}
            >
              <span className={styles.when}>
                <span>{relativeDayLabel(e.date, today)}</span>
                <small className="tnum">{e.allDay ? 'весь день' : formatMinutes(e.start)}</small>
              </span>
              <i className={styles.dot} style={{ background: BADGE_COLOR[e.badge] }} aria-hidden="true" />
              <span className={styles.text}>
                <span className={styles.title}>{e.title}</span>
                {(e.subtitle || e.notes) && <span className={styles.sub}>{e.subtitle || e.notes}</span>}
              </span>
            </Pressable>
          </li>
        ))}
      </ul>
    </section>
  )
}
