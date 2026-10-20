import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { BarSlot } from '../../app/bar'
import { useCalendar } from '../../app/calendar'
import { useNavigation } from '../../app/navigation'
import { TapToSay } from '../../components/BottomBar'
import { ArrowRightIcon, BackIcon, ChevronDownIcon, CloseIcon } from '../../components/Icons'
import { Sheet } from '../../components/Sheet'
import { CircleButton } from '../../components/ui'
import { MONTHS, startOfDay } from '../../lib/dates'
import { useTimeout } from '../../lib/hooks'
import { itemVariants, spring } from '../../lib/motion'
import { MonthGrid, type MonthView } from './MonthGrid'
import { MonthPicker } from './MonthPicker'
import { TodayCard } from './TodayCard'
import styles from './Month.module.css'

/** Задержка перед переходом в день — чтобы успела отыграть подсветка выбранной даты. */
const OPEN_DAY_DELAY = 260

export function Month() {
  const { back, go } = useNavigation()
  const { selectedDate, setSelectedDate } = useCalendar()
  const today = startOfDay(new Date())
  const [view, setView] = useState<MonthView>({
    year: selectedDate.getFullYear(),
    month: selectedDate.getMonth(),
    dir: 0,
  })
  const [picked, setPicked] = useState<Date | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  // Переход по таймеру снимается, если экран закрыли раньше; повторный тап перезапускает отсчёт.
  useTimeout(() => go('day'), picked ? OPEN_DAY_DELAY : null, picked)

  const shift = (delta: number) => {
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth(), dir: delta }
    })
  }

  const openDay = (d: Date) => {
    setPicked(d)
    setSelectedDate(d)
  }

  return (
    <Sheet>
      <BarSlot id="say">
        <TapToSay />
      </BarSlot>

      <motion.header variants={itemVariants} className={styles.header}>
        <div className={styles.titles}>
          <div className={styles.yearRow}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.h1
                key={view.year}
                className={`display ${styles.year}`}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={spring}
              >
                {view.year}
              </motion.h1>
            </AnimatePresence>
            <CircleButton
              tone="white"
              size={36}
              onClick={() => setPickerOpen((o) => !o)}
              aria-label="Выбрать месяц"
              aria-expanded={pickerOpen}
            >
              <motion.span animate={{ rotate: pickerOpen ? 180 : 0 }} transition={spring} className={styles.flex}>
                <ChevronDownIcon size={16} strokeWidth={2.2} />
              </motion.span>
            </CircleButton>
          </div>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.h2
              key={view.month}
              className={`display ${styles.month}`}
              initial={{ opacity: 0, x: view.dir * 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: view.dir * -30 }}
              transition={spring}
              aria-live="polite"
            >
              {MONTHS[view.month]}
            </motion.h2>
          </AnimatePresence>
        </div>
        <div className={styles.headerSide}>
          <CircleButton tone="white" size={44} onClick={back} aria-label="Закрыть">
            <CloseIcon size={20} />
          </CircleButton>
          <div className={styles.arrows}>
            <CircleButton tone="white" size={44} onClick={() => shift(-1)} aria-label="Предыдущий месяц">
              <BackIcon size={18} />
            </CircleButton>
            <CircleButton tone="white" size={44} onClick={() => shift(1)} aria-label="Следующий месяц">
              <ArrowRightIcon size={18} />
            </CircleButton>
          </div>
        </div>
      </motion.header>

      <AnimatePresence initial={false}>
        {pickerOpen && (
          <MonthPicker
            month={view.month}
            year={view.year}
            onPick={(i) => {
              setView((v) => ({ year: v.year, month: i, dir: i > v.month ? 1 : -1 }))
              setPickerOpen(false)
            }}
            onYear={(delta) => setView((v) => ({ ...v, year: v.year + delta, dir: delta }))}
          />
        )}
      </AnimatePresence>

      <motion.div variants={itemVariants} className={styles.calendar}>
        <MonthGrid view={view} today={today} picked={picked} onPick={openDay} onSwipe={shift} />
      </motion.div>

      <motion.div variants={itemVariants}>
        <TodayCard today={today} onOpen={() => openDay(today)} />
      </motion.div>
    </Sheet>
  )
}
