import { AnimatePresence, motion, type PanInfo } from 'framer-motion'
import { useMemo, useState } from 'react'
import { useApp, useBar } from '../app/store'
import { BADGE_ICON, CardsIcon, CloseIcon, ListIcon, MoonIcon, SunIcon } from '../components/Icons'
import { Sheet } from '../components/Sheet'
import { CircleButton, Pressable } from '../components/ui'
import { DAY_PARTS, eventsFor, type CalendarEvent, type DayPart } from '../data'
import { BADGE_COLOR } from '../lib/badges'
import {
  MONTHS_GENITIVE,
  WEEKDAYS,
  WEEKDAYS_SHORT,
  addDays,
  formatMinutes,
  isSameDay,
  isWeekend,
  startOfWeek,
} from '../lib/dates'
import { ease, itemVariants, spring } from '../lib/motion'
import styles from './Day.module.css'

type Mode = 'timeline' | 'agenda'

const HOUR_H = 62

export function Day() {
  const { reset, selectedDate, setSelectedDate, booking } = useApp()
  const [mode, setMode] = useState<Mode>('timeline')
  const [open, setOpen] = useState<DayPart['id']>('morning')
  const events = useMemo(() => eventsFor(selectedDate, booking), [selectedDate, booking])

  useBar(
    {
      key: 'day-mode',
      center: <ModeToggle mode={mode} onChange={setMode} />,
    },
    [mode],
  )

  return (
    <Sheet scroll={false} innerClassName={styles.inner}>
      <motion.header variants={itemVariants} className={styles.header}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={selectedDate.toDateString()}
            initial={{ opacity: 0, y: 16, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -16, filter: 'blur(6px)' }}
            transition={spring}
          >
            <h1 className={`display ${styles.weekday}`}>{WEEKDAYS[selectedDate.getDay()]}</h1>
            <h2 className={`display ${styles.date}`}>
              {selectedDate.getDate()} {MONTHS_GENITIVE[selectedDate.getMonth()]}
            </h2>
          </motion.div>
        </AnimatePresence>
        <CircleButton tone="white" size={44} onClick={() => reset('home')} aria-label="Закрыть">
          <CloseIcon size={20} />
        </CircleButton>
      </motion.header>

      <div className={styles.body}>
        <AnimatePresence mode="popLayout" initial={false}>
          {mode === 'timeline' ? (
            <motion.div
              key="timeline"
              className={styles.parts}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={spring}
            >
              {DAY_PARTS.map((part, i) => (
                <PartCard
                  key={part.id}
                  part={part}
                  index={i}
                  expanded={open === part.id}
                  onOpen={() => setOpen(part.id)}
                  events={events.filter((e) => e.start >= part.from && e.start < part.to)}
                  dateKey={selectedDate.toDateString()}
                />
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="agenda"
              className={`${styles.agenda} scroll-y`}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={spring}
            >
              <Agenda events={events} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <motion.div variants={itemVariants}>
        <WeekStrip selected={selectedDate} onSelect={setSelectedDate} />
      </motion.div>
    </Sheet>
  )
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className={styles.toggle} role="tablist" aria-label="Вид">
      {(
        [
          ['timeline', ListIcon, 'Шкала времени'],
          ['agenda', CardsIcon, 'Список'],
        ] as const
      ).map(([id, Icon, label]) => (
        <Pressable
          key={id}
          role="tab"
          aria-selected={mode === id}
          aria-label={label}
          className={styles.toggleBtn}
          onClick={() => onChange(id)}
          scale={0.9}
        >
          {mode === id && <motion.i layoutId="mode-knob" className={styles.knob} transition={spring} />}
          <Icon size={20} />
        </Pressable>
      ))}
    </div>
  )
}

const PART_ICON = { morning: SunIcon, afternoon: SunIcon, night: MoonIcon }

function PartCard({
  part,
  index,
  expanded,
  onOpen,
  events,
  dateKey,
}: {
  part: DayPart
  index: number
  expanded: boolean
  onOpen: () => void
  events: CalendarEvent[]
  dateKey: string
}) {
  const Icon = PART_ICON[part.id]
  const hours = (part.to - part.from) / 60
  return (
    <motion.section
      layout
      transition={spring}
      className={`${styles.part} ${styles[part.id]} ${expanded ? styles.partOpen : ''}`}
      style={{ zIndex: index + 1, flex: expanded ? '1 1 0%' : '0 0 auto', borderRadius: 30 }}
    >
      <motion.button
        layout="position"
        type="button"
        className={styles.partHead}
        onClick={onOpen}
        aria-expanded={expanded}
      >
        <span className={styles.partTitle}>{part.title}</span>
        {!expanded && events.length > 0 && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={styles.partCount}>
            {events.length} {plural(events.length)}
          </motion.span>
        )}
        <span className={styles.partIcon}>
          <Icon size={15} strokeWidth={2} />
        </span>
      </motion.button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="tl"
            layout
            className={`${styles.timelineWrap} scroll-y`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.3, delay: 0.12 } }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={dateKey}
                className={styles.timeline}
                style={{ height: hours * HOUR_H }}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={spring}
              >
                {Array.from({ length: hours }, (_, h) => (
                  <span key={h} className={`${styles.hour} tnum`} style={{ top: h * HOUR_H }}>
                    {formatMinutes(part.from + h * 60)}
                  </span>
                ))}
                {events.map((e, i) => (
                  <EventCard key={e.id} event={e} from={part.from} index={i} />
                ))}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}

function plural(n: number) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'событие'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'события'
  return 'событий'
}

function EventCard({ event, from, index }: { event: CalendarEvent; from: number; index: number }) {
  const BadgeIcon = BADGE_ICON[event.badge]
  const top = ((event.start - from) / 60) * HOUR_H + 3
  const height = Math.max(((event.end - event.start) / 60) * HOUR_H - 6, 44)
  return (
    <motion.div
      className={`${styles.event} ${event.highlight ? styles.eventNew : ''}`}
      style={{ top, height }}
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...spring, delay: 0.15 + index * 0.06 }}
    >
      <span className={styles.eventTitle}>{event.title}</span>
      {event.subtitle && <span className={styles.eventSub}>{event.subtitle}</span>}
      <i className={styles.badge} style={{ background: BADGE_COLOR[event.badge] }}>
        <BadgeIcon size={10} strokeWidth={2.4} />
      </i>
      {event.sleepGraph && <SleepGraph />}
      {event.highlight && <span className={styles.newTag}>Новое</span>}
    </motion.div>
  )
}

function SleepGraph() {
  const bars = useMemo(
    () =>
      Array.from({ length: 64 }, (_, i) => {
        const wave = Math.sin(i / 5) * 0.35 + Math.sin(i / 2.3) * 0.2
        return 0.25 + Math.abs(wave) + ((i * 7919) % 13) / 60
      }),
    [],
  )
  return (
    <span className={styles.sleep} aria-hidden="true">
      {bars.map((h, i) => (
        <motion.i
          key={i}
          initial={{ scaleY: 0 }}
          animate={{ scaleY: Math.min(h, 1) }}
          transition={{ duration: 0.5, delay: 0.3 + i * 0.008, ease }}
        />
      ))}
    </span>
  )
}

function Agenda({ events }: { events: CalendarEvent[] }) {
  return (
    <div className={styles.agendaList}>
      {events.map((e, i) => {
        const part = DAY_PARTS.find((p) => e.start >= p.from && e.start < p.to)
        const prev = i > 0 ? DAY_PARTS.find((p) => events[i - 1].start >= p.from && events[i - 1].start < p.to) : null
        return (
          <div key={e.id}>
            {part && part !== prev && <p className={styles.agendaPart}>{part.title}</p>}
            <motion.div
              className={`${styles.agendaRow} ${e.highlight ? styles.eventNew : ''}`}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...spring, delay: i * 0.04 }}
            >
              <span className={`${styles.agendaTime} tnum`}>
                {formatMinutes(e.start)}
                <small>{formatMinutes(e.end)}</small>
              </span>
              <i style={{ background: BADGE_COLOR[e.badge] }} />
              <span className={styles.agendaText}>
                <span className={styles.eventTitle}>{e.title}</span>
                {e.subtitle && <span className={styles.eventSub}>{e.subtitle}</span>}
              </span>
            </motion.div>
          </div>
        )
      })}
    </div>
  )
}

function WeekStrip({ selected, onSelect }: { selected: Date; onSelect: (d: Date) => void }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(selected))
  const [dir, setDir] = useState(0)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const today = new Date()

  const shift = (delta: number) => {
    setDir(delta)
    setWeekStart((w) => addDays(w, delta * 7))
  }

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -50) shift(1)
    else if (info.offset.x > 50) shift(-1)
  }

  return (
    <div className={styles.week}>
      <i className={styles.grabber} />
      <div className={styles.weekViewport}>
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={weekStart.toDateString()}
            className={styles.weekRow}
            initial={{ opacity: 0, x: dir * 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -60 }}
            transition={spring}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            onDragEnd={onDragEnd}
          >
            {days.map((d, i) => {
              const active = isSameDay(d, selected)
              return (
                <Pressable
                  key={i}
                  className={`${styles.weekDay} ${isWeekend(d) ? styles.weekEnd : ''} ${active ? styles.weekActive : ''}`}
                  onClick={() => onSelect(d)}
                  scale={0.88}
                  aria-pressed={active}
                >
                  {active && <motion.i layoutId="week-sel" className={styles.weekSel} transition={spring} />}
                  <span className={styles.weekName}>{WEEKDAYS_SHORT[i]}</span>
                  <span className={`${styles.weekNum} tnum`}>{d.getDate()}</span>
                  {isSameDay(d, today) && <span className={styles.weekToday} />}
                </Pressable>
              )
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
