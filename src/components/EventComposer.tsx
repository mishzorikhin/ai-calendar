import { AnimatePresence, motion } from 'framer-motion'
import { useLayoutEffect, useRef, useState } from 'react'
import { useAssistant } from '../app/assistant'
import { useCalendar } from '../app/calendar'
import { useComposer, type ComposerRequest } from '../app/composer'
import { useNavigation } from '../app/navigation'
import { TIME_OPTIONS, firstFreeTime, nearestTimeOption, slotAt } from '../domain/calendar'
import { minutesOf } from '../lib/hooks'
import { addDays, formatMinutes, isSameDay, relativeDayLabel, startOfDay } from '../lib/dates'
import { spring } from '../lib/motion'
import { eventsFor } from '../mocks/calendar'
import { BottomSheet } from './BottomSheet'
import { CloseIcon, InfinityIcon } from './Icons'
import { CircleButton, Pill, Pressable } from './ui'
import styles from './EventComposer.module.css'

const DURATIONS = [
  { value: 30, label: '30 мин' },
  { value: 60, label: '1 ч' },
  { value: 90, label: '1,5 ч' },
  { value: 120, label: '2 ч' },
] as const

const FORM_ID = 'event-composer'

/** Шторка быстрого создания события: открывается по «+» или по нажатию на пустое время в дне. */
export function EventComposer() {
  const { request, close } = useComposer()
  return <AnimatePresence>{request && <Composer key="composer" request={request} onClose={close} />}</AnimatePresence>
}

function Composer({ request, onClose }: { request: ComposerRequest; onClose: () => void }) {
  const { addEvent, booking, customEvents, setSelectedDate } = useCalendar()
  const { route, go } = useNavigation()
  const { setDraft } = useAssistant()
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(request.date)
  const [start, setStart] = useState(() => {
    if (request.start !== null) return nearestTimeOption(request.start)
    const now = new Date()
    const from = isSameDay(request.date, now) ? minutesOf(now) : 0
    return firstFreeTime(eventsFor(request.date, booking, customEvents), from)
  })
  const [duration, setDuration] = useState<number>(60)
  const times = useRef<HTMLDivElement>(null)

  const today = startOfDay(new Date())
  const dates = [today, addDays(today, 1), addDays(today, 2)]
  if (!dates.some((d) => isSameDay(d, request.date))) dates.push(request.date)

  const conflicts = slotAt(eventsFor(date, booking, customEvents), start, duration).conflicts

  // Прокручиваем ленту времени к выбранному варианту до первой отрисовки.
  useLayoutEffect(() => {
    const el = times.current
    const active = el?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (el && active) el.scrollLeft = active.offsetLeft - el.clientWidth / 2 + active.clientWidth / 2
  }, [])

  const create = () => {
    addEvent({
      id: `custom-${Date.now()}`,
      title: title.trim() || 'Новое событие',
      subtitle: 'Добавлено вручную',
      start,
      end: start + duration,
      badge: 'routine',
      highlight: true,
      date,
    })
    setSelectedDate(date)
    onClose()
    if (route !== 'day') go('day')
  }

  const delegate = () => {
    setDraft(title.trim() ? `Запланируй: ${title.trim()}` : '')
    onClose()
    go('chat')
  }

  return (
    <BottomSheet
      label="Новое событие"
      onClose={onClose}
      footer={
        <div className={styles.actions}>
          <Pill tone="dark" type="submit" form={FORM_ID} className={styles.create}>
            Создать событие
          </Pill>
          <Pressable className={styles.delegate} onClick={delegate}>
            <InfinityIcon size={18} />
            Поручить ассистенту
          </Pressable>
        </div>
      }
    >
      <form
        id={FORM_ID}
        onSubmit={(e) => {
          e.preventDefault()
          create()
        }}
      >
        <div className={styles.head}>
          <h2>Новое событие</h2>
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
          {TIME_OPTIONS.map((t) => (
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
          {DURATIONS.map((d) => (
            <Pill
              key={d.value}
              small
              tone={d.value === duration ? 'dark' : 'ghost'}
              aria-pressed={d.value === duration}
              onClick={() => setDuration(d.value)}
            >
              {d.label}
            </Pill>
          ))}
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
              {formatMinutes(start)}–{formatMinutes(start + duration)}
            </span>
            {conflicts.length ? ` пересекается с: ${conflicts.join(', ')}` : ' — время свободно'}
          </motion.p>
        </AnimatePresence>
      </form>
    </BottomSheet>
  )
}
