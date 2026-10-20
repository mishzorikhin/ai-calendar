import { AnimatePresence, motion, useDragControls, type PanInfo } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../app/store'
import { TIME_OPTIONS, eventsFor, slotAt, type CalendarEvent } from '../data'
import { MONTHS_GENITIVE, WEEKDAYS, addDays, formatMinutes, isSameDay, startOfDay } from '../lib/dates'
import { softSpring, spring } from '../lib/motion'
import { CloseIcon, InfinityIcon } from './Icons'
import { CircleButton, Pill, Pressable } from './ui'
import styles from './EventComposer.module.css'

const DURATIONS = [
  { value: 30, label: '30 мин' },
  { value: 60, label: '1 ч' },
  { value: 90, label: '1,5 ч' },
  { value: 120, label: '2 ч' },
]

/** Шторка быстрого создания события: открывается по «+» или по нажатию на пустое время в дне. */
export function EventComposer() {
  const { composer, closeComposer } = useApp()
  return (
    <AnimatePresence>
      {composer && (
        <Composer key="composer" initialDate={composer.date} initialStart={composer.start} onClose={closeComposer} />
      )}
    </AnimatePresence>
  )
}

function Composer({
  initialDate,
  initialStart,
  onClose,
}: {
  initialDate: Date
  initialStart: number | null
  onClose: () => void
}) {
  const { addEvent, booking, customEvents, setSelectedDate, route, go, setDraft } = useApp()
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(initialDate)
  const [start, setStart] = useState(() =>
    initialStart !== null
      ? nearestOption(initialStart)
      : firstFree(eventsFor(initialDate, booking, customEvents), initialDate),
  )
  const [duration, setDuration] = useState(60)
  const drag = useDragControls()
  const times = useRef<HTMLDivElement>(null)

  const today = startOfDay(new Date())
  const dates = useMemo(() => {
    const list = [today, addDays(today, 1), addDays(today, 2)]
    if (!list.some((d) => isSameDay(d, initialDate))) list.push(initialDate)
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDate])

  const conflicts = slotAt(eventsFor(date, booking, customEvents), start, duration).conflicts

  // Прокручиваем ленту времени к выбранному варианту.
  useEffect(() => {
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

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 600) onClose()
  }

  return (
    <motion.div className={styles.root} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className={styles.backdrop} onClick={onClose} />
      <motion.form
        className={styles.sheet}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%', transition: { duration: 0.28 } }}
        transition={softSpring}
        drag="y"
        dragControls={drag}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.05, bottom: 0.8 }}
        onDragEnd={onDragEnd}
        onSubmit={(e) => {
          e.preventDefault()
          create()
        }}
        role="dialog"
        aria-label="Новое событие"
      >
        <div className={styles.handleZone} onPointerDown={(e) => drag.start(e)}>
          <i />
        </div>
        <div className={styles.head}>
          <h2>Новое событие</h2>
          <CircleButton tone="gray" size={40} onClick={onClose} aria-label="Закрыть">
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

        <p className={styles.label}>День</p>
        <div className={`${styles.row} scroll-x`}>
          {dates.map((d) => (
            <Pill
              key={d.toDateString()}
              small
              tone={isSameDay(d, date) ? 'dark' : 'ghost'}
              aria-pressed={isSameDay(d, date)}
              onClick={() => setDate(d)}
            >
              {dateLabel(d, today)}
            </Pill>
          ))}
        </div>

        <p className={styles.label}>Начало</p>
        <div ref={times} className={`${styles.row} scroll-x`}>
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

        <p className={styles.label}>Длительность</p>
        <div className={styles.row}>
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

        <div className={styles.actions}>
          <Pill tone="dark" type="submit" className={styles.create}>
            Создать событие
          </Pill>
          <Pressable className={styles.delegate} onClick={delegate}>
            <InfinityIcon size={18} />
            Поручить ассистенту
          </Pressable>
        </div>
      </motion.form>
    </motion.div>
  )
}

/** Ближайшее свободное время (шаг 30 минут), не раньше текущего момента. */
function firstFree(events: CalendarEvent[], date: Date) {
  const now = new Date()
  const from = isSameDay(date, now) ? now.getHours() * 60 + now.getMinutes() : 0
  return (
    TIME_OPTIONS.find((t) => t >= from && slotAt(events, t, 60).conflicts.length === 0) ??
    TIME_OPTIONS.find((t) => slotAt(events, t, 60).conflicts.length === 0) ??
    TIME_OPTIONS[0]
  )
}

function nearestOption(mins: number) {
  return TIME_OPTIONS.reduce((best, t) => (Math.abs(t - mins) < Math.abs(best - mins) ? t : best), TIME_OPTIONS[0])
}

function dateLabel(d: Date, today: Date) {
  if (isSameDay(d, today)) return 'Сегодня'
  if (isSameDay(d, addDays(today, 1))) return 'Завтра'
  return `${WEEKDAYS[d.getDay()].slice(0, 2)}, ${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}`
}
