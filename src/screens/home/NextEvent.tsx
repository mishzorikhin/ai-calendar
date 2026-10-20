import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useState } from 'react'
import { Pill, Pressable } from '../../components/ui'
import type { CalendarEvent } from '../../domain/types'
import { formatMinutes, formatTimer, isSameDay } from '../../lib/dates'
import { useInterval } from '../../lib/hooks'
import styles from './Home.module.css'

/** Ближайшее событие: для онлайн-встреч — «Подключиться» с таймером участия. */
export function NextEvent({ event, date, onOpen }: { event: CalendarEvent; date: Date; onOpen: () => void }) {
  const [joined, setJoined] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const still = useReducedMotion()
  const isToday = isSameDay(date, new Date())
  const online = event.badge === 'work'

  useInterval(() => setSeconds((s) => s + 1), joined ? 1000 : null)

  return (
    <div className={styles.meeting}>
      <Pressable className={styles.meetingText} scale={0.98} onClick={onOpen}>
        <span className="caption tnum">
          {isToday ? 'Далее' : 'Завтра'} · {formatMinutes(event.start)}–{formatMinutes(event.end)}
        </span>
        <span className={`title ${styles.meetingTitle}`}>{event.title}</span>
        {event.subtitle && <span className={styles.meetingSub}>{event.subtitle}</span>}
      </Pressable>
      <div className={styles.meetingActions}>
        {online && isToday && (
          <Pill
            tone={joined ? 'dark' : 'white'}
            small
            onClick={() => setJoined((r) => !r)}
            className={styles.start}
            aria-pressed={joined}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {joined ? (
                <motion.span
                  key="run"
                  className={styles.running}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                >
                  <motion.i
                    animate={still ? undefined : { opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1.2, repeat: Infinity }}
                  />
                  <span className="tnum">На встрече · {formatTimer(seconds)}</span>
                </motion.span>
              ) : (
                <motion.span
                  key="join"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                >
                  Подключиться
                </motion.span>
              )}
            </AnimatePresence>
          </Pill>
        )}
        <Pill tone="ghost" small onClick={onOpen}>
          Весь день
        </Pill>
      </div>
    </div>
  )
}
