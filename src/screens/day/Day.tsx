import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { useDayEvents } from '../../api/queries'
import { BarSlot } from '../../app/bar'
import { useCalendar } from '../../app/calendar'
import { useComposer } from '../../app/composer'
import { useNavigation } from '../../app/navigation'
import { CloseIcon } from '../../components/Icons'
import { Sheet } from '../../components/Sheet'
import { CircleButton, Pill } from '../../components/ui'
import { DAY_PARTS, partOf } from '../../domain/calendar'
import type { DayPartId } from '../../domain/types'
import { MONTHS_GENITIVE, WEEKDAYS, dayKey, isSameDay, startOfWeek } from '../../lib/dates'
import { minutesOf, useNow } from '../../lib/hooks'
import { itemVariants, spring } from '../../lib/motion'
import { Agenda } from './Agenda'
import { AllDayStrip } from './AllDayStrip'
import { ModeToggle, type DayMode } from './ModeToggle'
import { PartCard } from './PartCard'
import { WeekStrip } from './WeekStrip'
import styles from './Day.module.css'

export function Day() {
  const { back } = useNavigation()
  const { selectedDate, setSelectedDate } = useCalendar()
  const composer = useComposer()
  const now = useNow()
  const [mode, setMode] = useState<DayMode>('timeline')
  // Раскрытая часть суток запоминается для конкретного дня; по умолчанию —
  // текущая часть для сегодняшнего дня и утро для остальных.
  const [opened, setOpened] = useState<{ day: string; part: DayPartId } | null>(null)

  const isToday = isSameDay(selectedDate, now)
  const key = dayKey(selectedDate)
  const open: DayPartId = opened?.day === key ? opened.part : isToday ? partOf(minutesOf(now)) : 'morning'
  const { events, allDay } = useDayEvents(selectedDate)

  return (
    <Sheet scroll={false} innerClassName={styles.inner}>
      <BarSlot id="day-mode">
        <ModeToggle mode={mode} onChange={setMode} />
      </BarSlot>

      <motion.header variants={itemVariants} className={styles.header}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={spring}
            aria-live="polite"
          >
            <h1 className={`display ${styles.weekday}`}>{WEEKDAYS[selectedDate.getDay()]}</h1>
            <h2 className={`display ${styles.date}`}>
              {selectedDate.getDate()} {MONTHS_GENITIVE[selectedDate.getMonth()]}
            </h2>
          </motion.div>
        </AnimatePresence>
        <div className={styles.headerActions}>
          <AnimatePresence initial={false}>
            {!isToday && (
              <motion.span
                key="today"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={spring}
              >
                <Pill small tone="white" onClick={() => setSelectedDate(now)}>
                  Сегодня
                </Pill>
              </motion.span>
            )}
          </AnimatePresence>
          <CircleButton tone="white" size={44} onClick={back} aria-label="Закрыть">
            <CloseIcon size={20} />
          </CircleButton>
        </div>
      </motion.header>

      <AllDayStrip events={allDay} onOpen={(e) => composer.open({ event: { ...e, date: selectedDate } })} />

      <div className={styles.body}>
        <AnimatePresence mode="popLayout" initial={false}>
          {mode === 'timeline' ? (
            <motion.div
              key="timeline"
              id="day-view"
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
                  onOpen={() => setOpened({ day: key, part: part.id })}
                  events={events.filter((e) => e.start >= part.from && e.start < part.to)}
                  dateKey={key}
                  nowMins={isToday ? minutesOf(now) : null}
                  onCreate={(start) => composer.open({ date: selectedDate, start })}
                  onEvent={(e) => composer.open({ event: { ...e, date: selectedDate } })}
                />
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="agenda"
              id="day-view"
              className={`${styles.agenda} scroll-y`}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={spring}
            >
              <Agenda events={events} onEvent={(e) => composer.open({ event: { ...e, date: selectedDate } })} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <motion.div variants={itemVariants}>
        {/* Ключ по неделе: выбор дня в другой неделе (например, «Сегодня») переносит ленту на неё. */}
        <WeekStrip key={dayKey(startOfWeek(selectedDate))} selected={selectedDate} onSelect={setSelectedDate} />
      </motion.div>
    </Sheet>
  )
}
