import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { useApp, useBar } from '../app/store'
import { TapToSay } from '../components/BottomBar'
import {
  ArrowRightIcon,
  BriefcaseIcon,
  CalendarIcon,
  CapIcon,
  CheckIcon,
  DumbbellIcon,
  StarIcon,
} from '../components/Icons'
import { Sheet } from '../components/Sheet'
import { Avatar, Pill, Pressable, SmartImage, Stack } from '../components/ui'
import { FRIEND, ME, eventsFor, type CalendarEvent } from '../data'
import {
  MONTHS_GENITIVE,
  MONTHS_SHORT,
  WEEKDAYS,
  addDays,
  formatMinutes,
  formatTimer,
  isSameDay,
  pad2,
  startOfDay,
} from '../lib/dates'
import { bouncy, itemVariants, spring } from '../lib/motion'
import styles from './Home.module.css'

export function Home() {
  const { go, booking, customEvents, setSelectedDate } = useApp()
  const today = startOfDay(new Date())

  useBar({ key: 'say', center: <TapToSay /> }, [])

  const openDay = (d: Date) => {
    setSelectedDate(startOfDay(d))
    go('day')
  }

  const { next, nextDate, count } = useMemo(() => {
    const now = new Date()
    const mins = now.getHours() * 60 + now.getMinutes()
    const todays = eventsFor(today, booking, customEvents).filter((e) => e.id !== 'sleep')
    const upcoming = todays.find((e) => e.end > mins)
    if (upcoming) return { next: upcoming, nextDate: today, count: todays.length }
    const tomorrow = addDays(today, 1)
    const first = eventsFor(tomorrow, booking, customEvents).find((e) => e.id !== 'sleep')
    return { next: first, nextDate: tomorrow, count: todays.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking, customEvents])

  return (
    <Sheet>
      <motion.header variants={itemVariants} className={styles.top}>
        <Pressable className={styles.todayLink} scale={0.97} onClick={() => openDay(today)}>
          <span className={styles.todayLabel}>
            {WEEKDAYS[today.getDay()]}, {today.getDate()} {MONTHS_GENITIVE[today.getMonth()]}
          </span>
          <span className={styles.todayHint}>
            Открыть день <ArrowRightIcon size={13} strokeWidth={2.2} />
          </span>
        </Pressable>
        <Pressable className={styles.dateChip} onClick={() => go('month')} aria-label="Календарь на месяц">
          <span className={`${styles.dateNum} tnum`}>{pad2(today.getDate())}</span>
          <span className={styles.dateMonth}>{MONTHS_SHORT[today.getMonth()]}</span>
          <span className={styles.dateBadge}>
            <CalendarIcon size={12} strokeWidth={2.2} />
          </span>
        </Pressable>
      </motion.header>

      <motion.section variants={itemVariants} className={styles.goals}>
        <div className={styles.goalsHead}>
          <div>
            <h1 className={`display ${styles.goalsTitle}`}>Сегодня</h1>
            <p className="caption">
              {count} {plural(count, ['событие', 'события', 'событий'])} в календаре
            </p>
          </div>
          <Stack overlap={9}>
            <Avatar initials="Г" color="#dfe2f7" size={30} />
            <Avatar initials={ME.initials} src={ME.photo} color="#cfe3d2" size={30} />
            <span className={styles.more}>+4</span>
          </Stack>
        </div>
        {next && <NextEvent event={next} date={nextDate} onOpen={() => openDay(nextDate)} />}
      </motion.section>

      <AnimatePresence initial={false}>
        {booking && (
          <motion.div
            key="booked"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ ...spring, delay: 0.3 }}
            className={styles.bookedWrap}
          >
            <p className={styles.label}>Скоро</p>
            <Pressable className={styles.booked} scale={0.98} onClick={() => openDay(booking.date)}>
              <SmartImage src={booking.restaurant.photo} art={booking.restaurant.art} className={styles.bookedThumb} />
              <span className={styles.bookedText}>
                <span className={styles.bookedTitle}>Завтрак · {booking.restaurant.name}</span>
                <span className="caption tnum">
                  {isSameDay(booking.date, today)
                    ? 'Сегодня'
                    : isSameDay(booking.date, addDays(today, 1))
                      ? 'Завтра'
                      : `${booking.date.getDate()} ${MONTHS_GENITIVE[booking.date.getMonth()]}`}
                  , {formatMinutes(booking.slot.start)} · бронь {booking.code}
                </span>
                {booking.invite && (
                  <span className={styles.invite}>
                    <Avatar initials={FRIEND.initials} src={FRIEND.photo} size={16} ring={false} color="#dfe2f7" />
                    Глеб приглашён · ждём ответа
                  </span>
                )}
              </span>
              <ArrowRightIcon size={18} className={styles.bookedArrow} />
              <motion.i
                className={styles.bookedGlow}
                initial={{ opacity: 0.9 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 2.4, delay: 0.8 }}
              />
            </Pressable>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.p variants={itemVariants} className={styles.label}>
        Задачи и цели
      </motion.p>

      <TasksGrid />

      <motion.div variants={itemVariants}>
        <PrepCard />
      </motion.div>
    </Sheet>
  )
}

function plural(n: number, forms: [string, string, string]) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return forms[0]
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1]
  return forms[2]
}

function NextEvent({ event, date, onOpen }: { event: CalendarEvent; date: Date; onOpen: () => void }) {
  const [joined, setJoined] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const isToday = isSameDay(date, new Date())
  const online = event.badge === 'work'

  useEffect(() => {
    if (!joined) return
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [joined])

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
                  <motion.i animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
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

function TasksGrid() {
  const [rating, setRating] = useState(0)
  const [rateOpen, setRateOpen] = useState(false)
  const [done, setDone] = useState(false)

  return (
    <div className={styles.grid}>
      <motion.div layout transition={spring} variants={itemVariants} className={rateOpen ? styles.span : undefined}>
        <div className={`${styles.trip} ${done ? styles.tripDone : ''}`}>
          <motion.i
            className={styles.blobA}
            animate={{ y: [0, -6, 0], rotate: [0, 4, 0] }}
            transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.i
            className={styles.blobB}
            animate={{ y: [0, 5, 0], x: [0, -4, 0] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className={styles.cardText}>
            <span className={styles.cardTitle}>Поездка во Францию</span>
            <span className="caption">Цель · к 26 {MONTHS_GENITIVE[6]}</span>
          </div>
          <Pressable
            className={`${styles.check} ${done ? styles.checkOn : ''}`}
            onClick={() => setDone((d) => !d)}
            aria-label={done ? 'Снять отметку' : 'Отметить выполненной'}
            aria-pressed={done}
          >
            <motion.span animate={{ scale: done ? [0.6, 1.2, 1] : 1 }} transition={bouncy}>
              <CheckIcon size={18} strokeWidth={2.2} />
            </motion.span>
          </Pressable>
        </div>
      </motion.div>

      <motion.div layout transition={spring} variants={itemVariants} className={rateOpen ? styles.span : undefined}>
        <div className={`${styles.dinner} ${rateOpen ? styles.dinnerOpen : ''}`}>
          <motion.div layout="position" className={styles.cardText}>
            <span className={styles.cardTitle}>{rating ? 'Ужин оценён' : 'Оцените ужин'}</span>
            <span className="caption">Water Bar · вчера</span>
          </motion.div>
          {!rateOpen && (
            <div className={styles.glass} aria-hidden="true">
              <i />
            </div>
          )}
          <div className={styles.rateRow}>
            <AnimatePresence mode="popLayout" initial={false}>
              {rateOpen ? (
                <motion.div
                  key="stars"
                  className={styles.stars}
                  role="radiogroup"
                  aria-label="Оценка ужина"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={spring}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable
                      key={n}
                      scale={0.8}
                      className={styles.star}
                      role="radio"
                      aria-checked={n === rating}
                      aria-label={`${n} из 5`}
                      onClick={() => {
                        setRating(n)
                        window.setTimeout(() => setRateOpen(false), 500)
                      }}
                    >
                      <motion.span
                        animate={{
                          scale: n <= rating ? [1, 1.3, 1] : 1,
                          color: n <= rating ? '#f5b83d' : '#d4d4da',
                        }}
                        transition={{ duration: 0.3, delay: n * 0.03 }}
                      >
                        <StarIcon size={28} />
                      </motion.span>
                    </Pressable>
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  key="btn"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                >
                  <Pill small tone="white" onClick={() => setRateOpen(true)}>
                    {rating ? (
                      <>
                        <StarIcon size={14} style={{ color: '#f5b83d' }} /> {rating}.0
                      </>
                    ) : (
                      'Оценить'
                    )}
                  </Pill>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

const CATEGORIES = [
  { id: 'study', icon: CapIcon, label: 'Учёба' },
  { id: 'sport', icon: DumbbellIcon, label: 'Спорт' },
  { id: 'work', icon: BriefcaseIcon, label: 'Работа' },
]

function PrepCard() {
  const [active, setActive] = useState('work')
  const current = CATEGORIES.find((c) => c.id === active)
  return (
    <div className={styles.prep}>
      <div className={styles.cardText}>
        <span className={styles.cardTitle}>Подготовка к встрече</span>
        <span className="caption">Бренд-команда · {current?.label}</span>
      </div>
      <div className={styles.segment} role="radiogroup" aria-label="Категория задачи">
        {CATEGORIES.map(({ id, icon: Icon, label }) => (
          <Pressable
            key={id}
            role="radio"
            aria-checked={active === id}
            aria-label={label}
            title={label}
            className={styles.segBtn}
            onClick={() => setActive(id)}
            scale={0.88}
          >
            {active === id && <motion.i layoutId="seg-active" className={styles.segActive} transition={spring} />}
            <Icon size={19} />
          </Pressable>
        ))}
      </div>
    </div>
  )
}
