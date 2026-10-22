import { AnimatePresence, m } from 'framer-motion'
import { useId, useState } from 'react'
import { LIMITS } from '../domain/limits'
import { MONTHS_GENITIVE, addDays, formatMinutes, fromISODate, parseMinutes, toISODate } from '../lib/dates'
import { spring } from '../lib/motion'
import { NativePicker } from './EventComposerParts'
import { CalendarIcon, CarIcon, ChevronDownIcon, ClockIcon, NoteIcon } from './Icons'
import { Pill, Pressable } from './ui'
import styles from './EventComposer.module.css'

export type Details = {
  notes: string
  url: string
  travel: number
  /** Последний день многодневного события, ГГГГ-ММ-ДД; '' — однодневное. */
  endDate: string
  /** Время конца в последний день (у многодневного со временем). */
  endTime: number
}

const TRAVEL = [0, 15, 30, 45, 60, 90]

const dayLabel = (iso: string) => {
  const d = fromISODate(iso)
  return `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}`
}

/** Ссылка на место в Яндекс Картах — поиск по тексту места. */
export const mapLink = (place: string) => `https://yandex.ru/maps/?text=${encodeURIComponent(place)}`

/**
 * «Подробнее» в шторке события: ссылка на созвон или билет, заметки, дорога до места и
 * «несколько дней». Свёрнуто, пока ничего из этого не задано.
 */
export function EventDetails({
  value,
  onChange,
  date,
  allDay,
  /** Повтор или событие подключённого календаря: несколько дней недоступны. */
  multiDayLocked,
}: {
  value: Details
  onChange: (patch: Partial<Details>) => void
  date: Date
  allDay: boolean
  multiDayLocked: boolean
}) {
  const filled = value.notes !== '' || value.url !== '' || value.travel > 0 || value.endDate !== ''
  const [open, setOpen] = useState(filled)
  const id = useId()
  const multi = value.endDate !== ''
  const summary = [
    value.url && 'ссылка',
    value.notes && 'заметки',
    value.travel > 0 && `дорога ${value.travel} мин`,
    multi && `до ${dayLabel(value.endDate)}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={styles.details}>
      <Pressable
        className={styles.detailsToggle}
        scale={0.98}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <NoteIcon size={16} />
        <span className={styles.detailsTitle}>
          Подробнее
          {summary && <small>{summary}</small>}
        </span>
        <ChevronDownIcon size={16} className={open ? styles.chevronOpen : styles.chevron} />
      </Pressable>
      <AnimatePresence initial={false}>
        {open && (
          <m.div
            id={id}
            className={styles.detailsBody}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
          >
            <input
              className={styles.subtitle}
              type="url"
              inputMode="url"
              value={value.url}
              maxLength={LIMITS.url}
              onChange={(e) => onChange({ url: e.target.value })}
              placeholder="Ссылка на созвон или билет"
              aria-label="Ссылка"
              enterKeyHint="done"
            />
            <textarea
              className={`${styles.subtitle} ${styles.notes}`}
              value={value.notes}
              maxLength={LIMITS.notes}
              rows={3}
              onChange={(e) => onChange({ notes: e.target.value })}
              placeholder="Заметки: повестка, что взять с собой"
              aria-label="Заметки"
            />

            {!allDay && (
              <>
                <p className={styles.label} id={`${id}-travel`}>
                  <CarIcon size={14} /> Дорога до места
                </p>
                <div className={`${styles.row} scroll-x`} role="group" aria-labelledby={`${id}-travel`}>
                  {TRAVEL.map((t) => (
                    <Pill
                      key={t}
                      small
                      tone={t === value.travel ? 'dark' : 'ghost'}
                      aria-pressed={t === value.travel}
                      onClick={() => onChange({ travel: t })}
                    >
                      {t === 0 ? 'Без дороги' : `${t} мин`}
                    </Pill>
                  ))}
                </div>
              </>
            )}

            {!multiDayLocked && (
              <>
                <p className={styles.label}>Несколько дней</p>
                <div className={styles.multiRow}>
                  <Pill
                    small
                    tone={multi ? 'dark' : 'ghost'}
                    aria-pressed={multi}
                    onClick={() => onChange({ endDate: multi ? '' : toISODate(addDays(date, 1)) })}
                  >
                    {multi ? 'Несколько дней' : 'Один день'}
                  </Pill>
                  {multi && (
                    <NativePicker
                      type="date"
                      value={value.endDate}
                      label="Последний день"
                      icon={<CalendarIcon size={14} />}
                      onPick={(v) => onChange({ endDate: v })}
                    >
                      до {dayLabel(value.endDate)}
                    </NativePicker>
                  )}
                  {multi && !allDay && (
                    <NativePicker
                      type="time"
                      value={formatMinutes(value.endTime % LIMITS.dayMinutes)}
                      label="Время конца в последний день"
                      icon={<ClockIcon size={14} />}
                      onPick={(v) => {
                        const mins = parseMinutes(v)
                        if (mins !== null) onChange({ endTime: mins === 0 ? LIMITS.dayMinutes : mins })
                      }}
                    >
                      в {formatMinutes(value.endTime % LIMITS.dayMinutes)}
                    </NativePicker>
                  )}
                </div>
              </>
            )}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}
