import { useDayEvents, useTasks } from '../../api/queries'
import { ArrowUpRightIcon } from '../../components/Icons'
import { Pressable } from '../../components/ui'
import { MONTHS_GENITIVE, formatMinutes, isSameDay } from '../../lib/dates'
import { minutesOf } from '../../lib/hooks'
import { pluralize } from '../../lib/plural'
import styles from './Month.module.css'

/** Сводка сегодняшнего дня из реальных данных; нажатие открывает день. */
export function TodayCard({ today, onOpen }: { today: Date; onOpen: () => void }) {
  const { events } = useDayEvents(today)
  const { tasks } = useTasks()
  const now = new Date()
  const next = isSameDay(today, now) ? events.find((e) => e.end > minutesOf(now)) : events[0]
  const openTasks = tasks.filter((t) => !t.done).length

  return (
    <Pressable className={styles.weather} scale={0.98} onClick={onOpen} aria-label="Открыть сегодняшний день">
      <span className={`${styles.temp} ${styles.todayNum} tnum`}>{today.getDate()}</span>
      <span className={styles.weatherText}>
        <span className={styles.weatherLabel}>Сегодня · {MONTHS_GENITIVE[today.getMonth()]}</span>
        <span className={styles.todayTitle}>{next ? next.title : 'День свободен'}</span>
        <span className={styles.weatherLabel}>
          {next && `в ${formatMinutes(next.start)} · `}
          {pluralize(events.length, ['событие', 'события', 'событий'])}
          {openTasks > 0 && ` · ${pluralize(openTasks, ['задача', 'задачи', 'задач'])}`}
        </span>
      </span>
      <span className={styles.weatherBtn}>
        <ArrowUpRightIcon size={18} />
      </span>
    </Pressable>
  )
}
