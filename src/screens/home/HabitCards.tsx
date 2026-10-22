import { m, useReducedMotion } from 'framer-motion'
import { useTasks, useUpdateTask } from '../../api/queries'
import { CheckIcon, FlameIcon } from '../../components/Icons'
import { Pressable } from '../../components/ui'
import { checkedNow, habitStreak, streakUnit, weekDots } from '../../domain/habit'
import type { Task } from '../../domain/types'
import { fromISODate, startOfWeek, toISODate } from '../../lib/dates'
import { useNow } from '../../lib/hooks'
import { bouncy, itemVariants, spring } from '../../lib/motion'
import { plural } from '../../lib/plural'
import { SHORT_WEEKDAYS } from '../../domain/profile'
import styles from './Habits.module.css'

/** Привычки: серия с огоньком, точки недели и отметка «сделано сегодня». */
export function HabitCards({ onEdit }: { onEdit: (task: Task) => void }) {
  const { tasks } = useTasks()
  const habits = tasks.filter((t) => t.kind === 'habit')
  if (habits.length === 0) return null
  return (
    <div className={`${styles.row} scroll-x`}>
      {habits.map((h) => (
        <m.div layout transition={spring} variants={itemVariants} key={h.id} className={styles.cell}>
          <HabitCard habit={h} onEdit={onEdit} />
        </m.div>
      ))}
    </div>
  )
}

function HabitCard({ habit, onEdit }: { habit: Task; onEdit: (task: Task) => void }) {
  const update = useUpdateTask()
  const still = useReducedMotion()
  const today = toISODate(useNow())
  const cadence = habit.cadence ?? 'daily'
  const checks = habit.checks ?? []
  const streak = habitStreak(cadence, checks, today)
  const done = checkedNow(cadence, checks, today)

  const toggle = () => {
    if (!done) return update.mutate({ id: habit.id, patch: { check: today } })
    // Раз в неделю: снимаем отметку этой недели, в какой бы день её ни поставили.
    const week = toISODate(startOfWeek(fromISODate(today)))
    const mark = cadence === 'weekly' ? checks.findLast((d) => toISODate(startOfWeek(fromISODate(d))) === week) : today
    if (mark) update.mutate({ id: habit.id, patch: { uncheck: mark } })
  }

  return (
    <div className={`${styles.card} ${done ? styles.cardDone : ''}`}>
      <Pressable
        className={styles.text}
        scale={0.98}
        onClick={() => onEdit(habit)}
        aria-label={`Изменить: ${habit.title}`}
      >
        <span className={`${styles.streak} ${streak > 0 ? styles.streakOn : ''}`}>
          <m.span
            className={styles.flame}
            animate={streak > 0 && !still ? { scale: [1, 1.12, 1] } : undefined}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          >
            <FlameIcon size={16} />
          </m.span>
          <b className="tnum">{streak}</b> {plural(streak, streakUnit(cadence))} подряд
        </span>
        <span className={styles.title}>{habit.title}</span>
      </Pressable>
      <div className={styles.week} aria-label="Эта неделя">
        {weekDots(checks, today).map((d) => (
          <span
            key={d.date}
            className={`${styles.dot} ${d.done ? styles.dotOn : ''} ${d.date === today ? styles.dotToday : ''}`}
            title={d.date}
          >
            {SHORT_WEEKDAYS[fromISODate(d.date).getDay()]}
          </span>
        ))}
      </div>
      <Pressable
        className={`${styles.check} ${done ? styles.checkOn : ''}`}
        onClick={toggle}
        aria-pressed={done}
        aria-label={done ? `Снять отметку: ${habit.title}` : `Сделано: ${habit.title}`}
      >
        <m.span animate={{ scale: done ? [0.6, 1.2, 1] : 1 }} transition={bouncy}>
          <CheckIcon size={18} strokeWidth={2.2} />
        </m.span>
      </Pressable>
    </div>
  )
}
