import { AnimatePresence, m, type PanInfo } from 'framer-motion'
import { useState } from 'react'
import { ArrowRightIcon, BackIcon } from '../../components/Icons'
import { Pressable } from '../../components/ui'
import { MONTHS_GENITIVE, WEEKDAYS, WEEKDAYS_SHORT, addDays, isSameDay, isWeekend, startOfWeek } from '../../lib/dates'
import { useDragClickGuard } from '../../lib/hooks'
import { spring } from '../../lib/motion'
import styles from './Day.module.css'

const SWIPE_OFFSET = 50

/** Лента недели: стрелки и свайп листают недели, нажатие выбирает день. */
export function WeekStrip({ selected, onSelect }: { selected: Date; onSelect: (d: Date) => void }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(selected))
  const [dir, setDir] = useState(0)
  const clickGuard = useDragClickGuard()
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const today = new Date()

  const shift = (delta: number) => {
    setDir(delta)
    setWeekStart((w) => addDays(w, delta * 7))
  }

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -SWIPE_OFFSET) shift(1)
    else if (info.offset.x > SWIPE_OFFSET) shift(-1)
  }

  return (
    <div className={styles.week}>
      <Pressable className={styles.weekArrow} onClick={() => shift(-1)} aria-label="Предыдущая неделя">
        <BackIcon size={18} />
      </Pressable>
      <div className={styles.weekViewport}>
        <AnimatePresence mode="popLayout" initial={false}>
          <m.div
            key={weekStart.toDateString()}
            className={styles.weekRow}
            initial={{ opacity: 0, x: dir * 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -60 }}
            transition={spring}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            {...clickGuard}
            onDragEnd={onDragEnd}
          >
            {days.map((d, i) => {
              const active = isSameDay(d, selected)
              return (
                <Pressable
                  key={d.toDateString()}
                  className={`${styles.weekDay} ${isWeekend(d) ? styles.weekEnd : ''} ${active ? styles.weekActive : ''}`}
                  onClick={() => onSelect(d)}
                  scale={0.88}
                  aria-pressed={active}
                  aria-current={isSameDay(d, today) ? 'date' : undefined}
                  aria-label={`${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}`}
                >
                  {active && <m.i layoutId="week-sel" className={styles.weekSel} transition={spring} />}
                  <span className={styles.weekName}>{WEEKDAYS_SHORT[i]}</span>
                  <span className={`${styles.weekNum} tnum`}>{d.getDate()}</span>
                  {isSameDay(d, today) && <span className={styles.weekToday} />}
                </Pressable>
              )
            })}
          </m.div>
        </AnimatePresence>
      </div>
      <Pressable className={styles.weekArrow} onClick={() => shift(1)} aria-label="Следующая неделя">
        <ArrowRightIcon size={18} />
      </Pressable>
    </div>
  )
}
