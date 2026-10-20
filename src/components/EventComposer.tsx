import { AnimatePresence, motion } from 'framer-motion'
import { useLayoutEffect, useRef, useState } from 'react'
import { apiErrorText } from '../api/api'
import { useCreateEvent, useDayEvents, useDeleteEvent, useUpdateEvent } from '../api/queries'
import { useAssistant } from '../app/assistant'
import { useCalendar } from '../app/calendar'
import { useComposer, type ComposerRequest } from '../app/composer'
import { useNavigation } from '../app/navigation'
import { TIME_OPTIONS, firstFreeTime, nearestTimeOption, slotAt } from '../domain/calendar'
import { minutesOf } from '../lib/hooks'
import { addDays, formatMinutes, isSameDay, relativeDayLabel, startOfDay } from '../lib/dates'
import { spring } from '../lib/motion'
import { BADGE_ICON } from './Icons'
import type { Badge } from '../domain/types'
import { BottomSheet } from './BottomSheet'
import { CloseIcon, InfinityIcon, TrashIcon } from './Icons'
import { CircleButton, Pill, Pressable } from './ui'
import styles from './EventComposer.module.css'

const DURATIONS = [
  { value: 30, label: '30 мин' },
  { value: 60, label: '1 ч' },
  { value: 90, label: '1,5 ч' },
  { value: 120, label: '2 ч' },
  { value: 180, label: '3 ч' },
  { value: 240, label: '4 ч' },
] as const

const BADGES = [
  { id: 'routine', label: 'Дело' },
  { id: 'work', label: 'Работа' },
  { id: 'food', label: 'Еда' },
  { id: 'sport', label: 'Спорт' },
  { id: 'read', label: 'Чтение' },
  { id: 'sleep', label: 'Сон' },
] as const satisfies readonly { id: Badge; label: string }[]

/** Сколько ближайших дней предлагаем в композере. */
const DAY_CHOICES = 14

const FORM_ID = 'event-composer'

/** Шторка события: «+» или тап по пустому времени — создание; тап по событию — правка и удаление. */
export function EventComposer() {
  const { request, close } = useComposer()
  return <AnimatePresence>{request && <Composer key="composer" request={request} onClose={close} />}</AnimatePresence>
}

/** Вставляет value в отсортированный список, если его там ещё нет. */
function withExtra(list: readonly number[], value?: number | null): number[] {
  if (value == null || list.includes(value)) return [...list]
  return [...list, value].sort((a, b) => a - b)
}

function durationLabel(mins: number): string {
  if (mins % 60 === 0) return `${mins / 60} ч`
  if (mins % 30 === 0) return `${mins / 60}`.replace('.', ',') + ' ч'
  return `${mins} мин`
}

function Composer({ request, onClose }: { request: ComposerRequest; onClose: () => void }) {
  const editing = request.event
  const { setSelectedDate } = useCalendar()
  const createEvent = useCreateEvent()
  const updateEvent = useUpdateEvent()
  const deleteEvent = useDeleteEvent()
  const { route, go } = useNavigation()
  const { setDraft } = useAssistant()

  const [title, setTitle] = useState(editing?.title ?? '')
  const [subtitle, setSubtitle] = useState(editing?.subtitle ?? '')
  const [date, setDate] = useState(request.date)
  const [pickedStart, setStart] = useState<number | null>(
    editing ? editing.start : request.start !== null ? nearestTimeOption(request.start) : null,
  )
  const [duration, setDuration] = useState<number>(editing ? editing.end - editing.start : 60)
  const [badge, setBadge] = useState<Badge>(editing?.badge ?? 'routine')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const times = useRef<HTMLDivElement>(null)

  const { events } = useDayEvents(date, { keepPrevious: false })
  const now = new Date()
  // Другие события дня — для подсчёта свободного времени (себя при правке не считаем).
  const others = events.filter((e) => e.id !== editing?.id)
  const start = pickedStart ?? firstFreeTime(others, isSameDay(date, now) ? minutesOf(now) : 0)
  const end = start + duration

  const today = startOfDay(new Date())
  const dates = Array.from({ length: DAY_CHOICES }, (_, i) => addDays(today, i))
  if (!dates.some((d) => isSameDay(d, date))) {
    dates.push(date)
    dates.sort((a, b) => a.getTime() - b.getTime())
  }

  const startOptions = withExtra(TIME_OPTIONS, editing?.start)
  const durations = withExtra(
    DURATIONS.map((d) => d.value),
    editing ? editing.end - editing.start : null,
  )

  const conflicts = slotAt(others, start, duration).conflicts

  // Прокручиваем ленту времени к выбранному варианту до первой отрисовки.
  useLayoutEffect(() => {
    const el = times.current
    const active = el?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (el && active) el.scrollLeft = active.offsetLeft - el.clientWidth / 2 + active.clientWidth / 2
  }, [])

  const pending = createEvent.isPending || updateEvent.isPending || deleteEvent.isPending
  const error = createEvent.error ?? updateEvent.error ?? deleteEvent.error

  const save = () => {
    if (editing) {
      updateEvent.mutate(
        {
          event: editing,
          patch: {
            title: title.trim() || editing.title,
            subtitle: subtitle.trim(),
            date,
            start,
            end,
            badge,
          },
        },
        { onSuccess: onClose },
      )
      return
    }
    createEvent.mutate(
      { title: title.trim() || 'Новое событие', subtitle: subtitle.trim(), start, end, date, badge },
      {
        onSuccess: () => {
          setSelectedDate(date)
          onClose()
          if (route !== 'day') go('day')
        },
      },
    )
  }

  const remove = () => {
    if (!editing) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    deleteEvent.mutate(editing, { onSuccess: onClose })
  }

  const delegate = () => {
    setDraft(title.trim() ? `Запланируй: ${title.trim()}` : '')
    onClose()
    go('chat')
  }

  return (
    <BottomSheet
      label={editing ? 'Изменить событие' : 'Новое событие'}
      onClose={onClose}
      footer={
        <div className={styles.actions}>
          {error && (
            <p className={styles.error} role="alert">
              {apiErrorText(error)}
            </p>
          )}
          {editing && (
            <Pressable
              className={`${styles.delete} ${confirmDelete ? styles.deleteSure : ''}`}
              onClick={remove}
              disabled={pending}
              aria-label={confirmDelete ? 'Подтвердить удаление' : 'Удалить событие'}
            >
              <TrashIcon size={17} />
              {confirmDelete ? 'Точно удалить?' : 'Удалить'}
            </Pressable>
          )}
          <Pill tone="dark" type="submit" form={FORM_ID} className={styles.create} disabled={pending}>
            {pending ? 'Сохраняю…' : editing ? 'Сохранить' : 'Создать событие'}
          </Pill>
          {!editing && (
            <Pressable className={styles.delegate} onClick={delegate}>
              <InfinityIcon size={18} />
              Поручить ассистенту
            </Pressable>
          )}
        </div>
      }
    >
      <form
        id={FORM_ID}
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <div className={styles.head}>
          <h2>{editing ? 'Изменить событие' : 'Новое событие'}</h2>
          <CircleButton tone="gray" size={44} onClick={onClose} aria-label="Закрыть">
            <CloseIcon size={18} />
          </CircleButton>
        </div>

        <input
          id="event-title"
          className={styles.title}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Название, например «Звонок маме»"
          aria-label="Название"
          enterKeyHint="done"
        />
        <input
          className={styles.subtitle}
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          placeholder="Место или заметка — необязательно"
          aria-label="Место или заметка"
          enterKeyHint="done"
        />

        <p className={styles.label} id="composer-day">
          День
        </p>
        <div className={`${styles.row} scroll-x`} role="group" aria-labelledby="composer-day">
          {dates.map((d) => (
            <Pill
              key={d.toDateString()}
              small
              tone={isSameDay(d, date) ? 'dark' : 'ghost'}
              aria-pressed={isSameDay(d, date)}
              onClick={() => setDate(d)}
            >
              {relativeDayLabel(d, today)}
            </Pill>
          ))}
        </div>

        <p className={styles.label} id="composer-start">
          Начало
        </p>
        <div ref={times} className={`${styles.row} scroll-x`} role="group" aria-labelledby="composer-start">
          {startOptions.map((t) => (
            <Pill
              key={t}
              small
              tone={t === start ? 'dark' : 'ghost'}
              aria-pressed={t === start}
              onClick={() => setStart(t)}
              className="tnum"
            >
              {formatMinutes(t)}
            </Pill>
          ))}
        </div>

        <p className={styles.label} id="composer-duration">
          Длительность
        </p>
        <div className={styles.row} role="group" aria-labelledby="composer-duration">
          {durations.map((d) => (
            <Pill
              key={d}
              small
              tone={d === duration ? 'dark' : 'ghost'}
              aria-pressed={d === duration}
              onClick={() => setDuration(d)}
            >
              {durationLabel(d)}
            </Pill>
          ))}
        </div>

        <p className={styles.label} id="composer-badge">
          Тип
        </p>
        <div className={`${styles.row} scroll-x`} role="group" aria-labelledby="composer-badge">
          {BADGES.map(({ id, label }) => {
            const Icon = BADGE_ICON[id]
            return (
              <Pill
                key={id}
                small
                tone={id === badge ? 'dark' : 'ghost'}
                aria-pressed={id === badge}
                onClick={() => setBadge(id)}
                className={styles.badgePill}
              >
                <Icon size={14} /> {label}
              </Pill>
            )
          })}
        </div>

        <AnimatePresence initial={false} mode="popLayout">
          <motion.p
            key={conflicts.join() || 'free'}
            className={`${styles.status} ${conflicts.length ? styles.warn : styles.ok}`}
            role="status"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={spring}
          >
            <span className="tnum">
              {formatMinutes(start)}–{formatMinutes(end)}
            </span>
            {conflicts.length ? ` пересекается с: ${conflicts.join(', ')}` : ' — время свободно'}
          </motion.p>
        </AnimatePresence>
      </form>
    </BottomSheet>
  )
}
