import { AnimatePresence, motion, type PanInfo } from 'framer-motion'
import { useState } from 'react'
import { useApp, useBar } from '../app/store'
import { TapToSay } from '../components/BottomBar'
import { ArrowRightIcon, ArrowUpRightIcon, BackIcon, ChevronDownIcon, CloseIcon, StarIcon } from '../components/Icons'
import { Sheet } from '../components/Sheet'
import { CircleButton, Pill, Pressable } from '../components/ui'
import { WeatherArt } from '../components/WeatherArt'
import { monthDots } from '../data'
import { BADGE_COLOR } from '../lib/badges'
import { MONTHS, MONTHS_GENITIVE, WEEKDAYS_SHORT, isSameDay, monthGrid, startOfDay } from '../lib/dates'
import { ease, itemVariants, spring } from '../lib/motion'
import styles from './Month.module.css'

export function Month() {
  const { back, go, setSelectedDate, selectedDate } = useApp()
  const today = startOfDay(new Date())
  const [view, setView] = useState({ year: selectedDate.getFullYear(), month: selectedDate.getMonth(), dir: 0 })
  const [picked, setPicked] = useState<Date | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  useBar({ key: 'say', center: <TapToSay /> }, [])

  const shift = (delta: number) => {
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth(), dir: delta }
    })
  }

  const openDay = (d: Date) => {
    setPicked(d)
    setSelectedDate(d)
    window.setTimeout(() => go('day'), 260)
  }

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -60 || info.velocity.x < -400) shift(1)
    else if (info.offset.x > 60 || info.velocity.x > 400) shift(-1)
  }

  const cells = monthGrid(view.year, view.month)

  return (
    <Sheet>
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
              <motion.span animate={{ rotate: pickerOpen ? 180 : 0 }} transition={spring} style={{ display: 'flex' }}>
                <ChevronDownIcon size={16} strokeWidth={2.2} />
              </motion.span>
            </CircleButton>
          </div>
          <AnimatePresence mode="popLayout" initial={false} custom={view.dir}>
            <motion.h2
              key={view.month}
              custom={view.dir}
              className={`display ${styles.month}`}
              initial={{ opacity: 0, x: view.dir * 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: view.dir * -30 }}
              transition={spring}
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
            <CircleButton tone="white" size={40} onClick={() => shift(-1)} aria-label="Предыдущий месяц">
              <BackIcon size={18} />
            </CircleButton>
            <CircleButton tone="white" size={40} onClick={() => shift(1)} aria-label="Следующий месяц">
              <ArrowRightIcon size={18} />
            </CircleButton>
          </div>
        </div>
      </motion.header>

      <AnimatePresence initial={false}>
        {pickerOpen && (
          <motion.div
            className={styles.pickerWrap}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.32, ease }}
          >
            <div
              className={`${styles.picker} scroll-x`}
              ref={(el) => {
                const active = el?.children[view.month] as HTMLElement | undefined
                if (el && active) el.scrollLeft = active.offsetLeft - el.clientWidth / 2 + active.clientWidth / 2
              }}
            >
              {MONTHS.map((m, i) => (
                <Pill
                  key={m}
                  small
                  tone={i === view.month ? 'dark' : 'white'}
                  onClick={() => {
                    setView((v) => ({ year: v.year, month: i, dir: i > v.month ? 1 : -1 }))
                    setPickerOpen(false)
                  }}
                >
                  {m}
                </Pill>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div variants={itemVariants} className={styles.calendar}>
        <div className={styles.weekdays}>
          {WEEKDAYS_SHORT.map((w, i) => (
            <span key={w} className={i >= 5 ? styles.weekend : undefined}>
              {w}
            </span>
          ))}
        </div>

        <div className={styles.gridViewport}>
          <AnimatePresence mode="popLayout" initial={false} custom={view.dir}>
            <motion.div
              key={`${view.year}-${view.month}`}
              className={styles.grid}
              custom={view.dir}
              initial={{ opacity: 0, x: view.dir * 80 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: view.dir * -80 }}
              transition={spring}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.18}
              onDragEnd={onDragEnd}
            >
              {cells.map((d, i) => {
                if (!d) return <span key={`e${i}`} />
                const isToday = isSameDay(d, today)
                const isPicked = picked && isSameDay(d, picked)
                const dots = monthDots(d)
                return (
                  <motion.button
                    key={d.getDate()}
                    type="button"
                    className={`${styles.day} ${d < today ? styles.dayPast : ''} ${isToday ? styles.today : ''}`}
                    onClick={() => openDay(d)}
                    whileTap={{ scale: 0.86 }}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ ...spring, delay: 0.08 + i * 0.008 }}
                    aria-label={`${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}`}
                  >
                    {isPicked && !isToday && (
                      <motion.i layoutId="month-picked" className={styles.picked} transition={spring} />
                    )}
                    <span className={`${styles.num} tnum`}>{d.getDate()}</span>
                    {(dots.length > 0 || isToday) && (
                      <span className={styles.dots}>
                        {(isToday ? ['sleep' as const] : dots).map((b, j) => (
                          <i key={j} style={{ background: BADGE_COLOR[b] }}>
                            <StarIcon size={8} />
                          </i>
                        ))}
                      </span>
                    )}
                  </motion.button>
                )
              })}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>

      <motion.div variants={itemVariants}>
        <Pressable className={styles.weather} scale={0.98} onClick={() => openDay(today)}>
          <div className={styles.weatherArt}>
            <WeatherArt />
          </div>
          <span className={styles.weatherText}>
            <span className={styles.weatherLabel}>Сегодня</span>
            <span className={`${styles.temp} tnum`}>14°C</span>
            <span className={styles.weatherLabel}>
              {today.getDate()} {MONTHS_GENITIVE[today.getMonth()]}
            </span>
          </span>
          <span className={styles.weatherBtn}>
            <ArrowUpRightIcon size={18} />
          </span>
        </Pressable>
      </motion.div>
    </Sheet>
  )
}
