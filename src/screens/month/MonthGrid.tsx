import { AnimatePresence, motion, type PanInfo } from 'framer-motion'
import { useMonthDots } from '../../api/queries'
import { MONTHS_GENITIVE, WEEKDAYS_SHORT, isSameDay, monthGrid } from '../../lib/dates'
import { BADGE_COLOR } from '../../lib/badges'
import { useDragClickGuard } from '../../lib/hooks'
import { spring } from '../../lib/motion'
import styles from './Month.module.css'

export type MonthView = { year: number; month: number; dir: number }

const SWIPE_OFFSET = 60
const SWIPE_VELOCITY = 400

/** Сетка месяца со свайпом между месяцами. */
export function MonthGrid({
  view,
  today,
  picked,
  onPick,
  onSwipe,
}: {
  view: MonthView
  today: Date
  picked: Date | null
  onPick: (d: Date) => void
  onSwipe: (delta: number) => void
}) {
  const { data: dots } = useMonthDots(view.year, view.month)
  const clickGuard = useDragClickGuard()

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -SWIPE_OFFSET || info.velocity.x < -SWIPE_VELOCITY) onSwipe(1)
    else if (info.offset.x > SWIPE_OFFSET || info.velocity.x > SWIPE_VELOCITY) onSwipe(-1)
  }

  return (
    <>
      <div className={styles.weekdays} aria-hidden="true">
        {WEEKDAYS_SHORT.map((w, i) => (
          <span key={w} className={i >= 5 ? styles.weekend : undefined}>
            {w}
          </span>
        ))}
      </div>

      <div className={styles.gridViewport}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={`${view.year}-${view.month}`}
            className={styles.grid}
            initial={{ opacity: 0, x: view.dir * 80 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: view.dir * -80 }}
            transition={spring}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.18}
            {...clickGuard}
            onDragEnd={onDragEnd}
          >
            {monthGrid(view.year, view.month).map((d, i) => {
              if (!d) return <span key={`empty-${i}`} />
              const isToday = isSameDay(d, today)
              const isPicked = picked !== null && isSameDay(d, picked)
              const badges = dots?.[d.getDate()] ?? []
              return (
                <motion.button
                  key={d.getDate()}
                  type="button"
                  className={`${styles.day} ${d < today ? styles.dayPast : ''} ${isToday ? styles.today : ''}`}
                  onClick={() => onPick(d)}
                  whileTap={{ scale: 0.86 }}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ ...spring, delay: 0.08 + i * 0.008 }}
                  aria-label={`${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}${isToday ? ', сегодня' : ''}${
                    badges.length ? `, событий: ${badges.length}` : ''
                  }`}
                  aria-current={isToday ? 'date' : undefined}
                >
                  {isPicked && !isToday && (
                    <motion.i layoutId="month-picked" className={styles.picked} transition={spring} />
                  )}
                  <span className={`${styles.num} tnum`}>{d.getDate()}</span>
                  {badges.length > 0 && (
                    <span className={styles.dots} aria-hidden="true">
                      {badges.slice(0, 2).map((b, j) => (
                        <i key={`${b}-${j}`} style={{ background: BADGE_COLOR[b] }} />
                      ))}
                      <span className={`${styles.dotCount} tnum`}>{badges.length}</span>
                    </span>
                  )}
                </motion.button>
              )
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  )
}
