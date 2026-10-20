import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { useActiveBooking } from '../../api/queries'
import { useCalendar } from '../../app/calendar'
import { useNavigation } from '../../app/navigation'
import { CheckIcon, ChevronDownIcon } from '../../components/Icons'
import { Pressable } from '../../components/ui'
import { formatMinutes, relativeDayLabel } from '../../lib/dates'
import { spring } from '../../lib/motion'
import { plural } from '../../lib/plural'
import styles from './Chat.module.css'

type Task = { id: string; title: string; sub: string; done: boolean; date: Date }

/** «Живая активность» сверху: число задач ассистента, по нажатию — их список. */
export function TasksPill() {
  const { setSelectedDate } = useCalendar()
  const booking = useActiveBooking()
  const { go } = useNavigation()
  const [open, setOpen] = useState(false)

  const today = new Date()
  const tasks: Task[] = [
    ...(booking
      ? [
          {
            id: 'booking',
            title: `Завтрак в ${booking.restaurant.name}`,
            sub: `${relativeDayLabel(booking.date)}, ${formatMinutes(booking.slot.start)} · бронь подтверждена`,
            done: true,
            date: booking.date,
          },
        ]
      : []),
    { id: 'prep', title: 'Подготовка к встрече', sub: 'Сегодня · собрать материалы', done: false, date: today },
    { id: 'trip', title: 'Поездка во Францию', sub: 'Ищу билеты на 26 июля', done: false, date: today },
  ]

  return (
    <>
      <motion.button
        type="button"
        className={styles.live}
        initial={{ scaleX: 0.6, opacity: 0 }}
        animate={{ scaleX: 1, opacity: 1 }}
        transition={{ ...spring, delay: 0.15 }}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="assistant-tasks"
      >
        <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>
          <b className="tnum">{tasks.length}</b> {plural(tasks.length, ['задача', 'задачи', 'задач'])}
        </motion.span>
        <motion.span className={styles.liveChevron} animate={{ rotate: open ? 180 : 0 }} transition={spring}>
          <ChevronDownIcon size={14} strokeWidth={2.4} />
        </motion.span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="scrim"
              className={styles.tasksScrim}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <motion.ul
              key="tasks"
              id="assistant-tasks"
              className={styles.tasks}
              initial={{ opacity: 0, scale: 0.85, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -16 }}
              transition={spring}
              onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            >
              {tasks.map((t) => (
                <li key={t.id}>
                  <Pressable
                    className={styles.task}
                    scale={0.98}
                    onClick={() => {
                      setSelectedDate(t.date)
                      go('day')
                    }}
                  >
                    <span className={`${styles.taskIcon} ${t.done ? styles.taskDone : ''}`} aria-hidden="true">
                      {t.done ? <CheckIcon size={14} strokeWidth={2.6} /> : <i />}
                    </span>
                    <span className={styles.taskText}>
                      <b>{t.title}</b>
                      <small>{t.sub}</small>
                    </span>
                  </Pressable>
                </li>
              ))}
            </motion.ul>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
