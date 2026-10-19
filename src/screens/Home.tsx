import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useApp, useBar } from '../app/store'
import { TapToSay } from '../components/BottomBar'
import { BookmarkIcon, BriefcaseIcon, CapIcon, CheckIcon, DumbbellIcon, StarIcon } from '../components/Icons'
import { Sheet } from '../components/Sheet'
import { Avatar, Pill, Pressable, SmartImage, Stack } from '../components/ui'
import { FRIEND, ME } from '../data'
import { MONTHS_GENITIVE, MONTHS_SHORT, formatMinutes, formatTimer, isSameDay, pad2, startOfDay } from '../lib/dates'
import { bouncy, itemVariants, spring } from '../lib/motion'
import styles from './Home.module.css'

export function Home() {
  const { go, booking, setSelectedDate } = useApp()
  const today = new Date()

  useBar({ key: 'say', center: <TapToSay /> }, [])

  const openDay = (d: Date) => {
    setSelectedDate(startOfDay(d))
    go('day')
  }

  return (
    <Sheet>
      <motion.header variants={itemVariants} className={styles.top}>
        <Pressable className={styles.dateChip} onClick={() => go('month')} aria-label="Открыть календарь">
          <span className={`${styles.dateNum} tnum`}>{pad2(today.getDate())}</span>
          <span className={styles.dateMonth}>{MONTHS_SHORT[today.getMonth()]}</span>
          <motion.i
            className={styles.dateDot}
            animate={{ scale: [1, 1.25, 1] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          />
        </Pressable>
      </motion.header>

      <motion.section variants={itemVariants} className={styles.goals}>
        <div className={styles.goalsHead}>
          <div>
            <h1 className={`display ${styles.goalsTitle}`}>Цели</h1>
            <p className="caption">На сегодня</p>
          </div>
          <Stack overlap={9}>
            <Avatar initials="Г" color="#dfe2f7" size={30} />
            <Avatar initials={ME.initials} src={ME.photo} color="#cfe3d2" size={30} />
            <span className={styles.more}>+4</span>
          </Stack>
        </div>
        <MeetingBlock onOpen={() => openDay(today)} />
      </motion.section>

      <motion.p variants={itemVariants} className={styles.label}>
        Недавние
      </motion.p>

      <AnimatePresence initial={false}>
        {booking && (
          <motion.div
            key="booked"
            initial={{ opacity: 0, height: 0, scale: 0.9 }}
            animate={{ opacity: 1, height: 'auto', scale: 1 }}
            transition={{ ...spring, delay: 0.35 }}
            className={styles.bookedWrap}
          >
            <Pressable className={styles.booked} scale={0.98} onClick={() => openDay(booking.date)}>
              <SmartImage src={booking.restaurant.photo} art={booking.restaurant.art} className={styles.bookedThumb} />
              <span className={styles.bookedText}>
                <span className={styles.bookedTitle}>Завтрак · {booking.restaurant.name}</span>
                <span className="caption">
                  {isSameDay(booking.date, today) ? 'Сегодня' : 'Завтра'}, {formatMinutes(booking.slot.start)} —{' '}
                  {formatMinutes(booking.slot.end)}
                </span>
              </span>
              <Stack overlap={8}>
                <Avatar initials={FRIEND.initials} src={FRIEND.photo} size={28} />
                <Avatar initials={ME.initials} src={ME.photo} size={28} color="#cfe3d2" />
              </Stack>
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

      <div className={styles.grid}>
        <motion.div variants={itemVariants}>
          <TripCard />
        </motion.div>
        <motion.div variants={itemVariants}>
          <DinnerCard />
        </motion.div>
      </div>

      <motion.div variants={itemVariants}>
        <PrepCard />
      </motion.div>
    </Sheet>
  )
}

function MeetingBlock({ onOpen }: { onOpen: () => void }) {
  const [running, setRunning] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [saved, setSaved] = useState(true)

  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [running])

  return (
    <div className={styles.meeting}>
      <Pressable className={styles.meetingText} scale={0.98} onClick={onOpen}>
        <span className="caption tnum">9:30</span>
        <span className={`title ${styles.meetingTitle}`}>Встреча</span>
        <span className={styles.meetingSub}>Про UX продукта</span>
      </Pressable>
      <Pressable
        className={`${styles.bookmark} ${saved ? styles.bookmarkOn : ''}`}
        onClick={() => setSaved((v) => !v)}
        aria-label="Закладка"
        aria-pressed={saved}
      >
        <motion.span animate={{ scale: saved ? [1, 1.3, 1] : 1 }} transition={{ duration: 0.35 }}>
          <BookmarkIcon size={20} />
        </motion.span>
      </Pressable>
      <motion.div layout transition={spring} className={styles.meetingActions}>
        <Pill
          tone={running ? 'dark' : 'white'}
          small
          onClick={() => setRunning((r) => !r)}
          className={styles.start}
          layout
          transition={spring}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {running ? (
              <motion.span
                key="run"
                className={styles.running}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                <motion.i animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
                <span className="tnum">{formatTimer(seconds)}</span>
              </motion.span>
            ) : (
              <motion.span
                key="start"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                {seconds > 0 ? 'Продолжить' : 'Начать'}
              </motion.span>
            )}
          </AnimatePresence>
        </Pill>
      </motion.div>
    </div>
  )
}

function TripCard() {
  const [done, setDone] = useState(false)
  return (
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
        <span className="caption">26 {MONTHS_GENITIVE[6]}</span>
      </div>
      <Pressable
        className={`${styles.check} ${done ? styles.checkOn : ''}`}
        onClick={() => setDone((d) => !d)}
        aria-label="Отметить выполненным"
        aria-pressed={done}
      >
        <motion.span animate={{ scale: done ? [0.6, 1.2, 1] : 1 }} transition={bouncy}>
          <CheckIcon size={18} strokeWidth={2.2} />
        </motion.span>
      </Pressable>
    </div>
  )
}

function DinnerCard() {
  const [rating, setRating] = useState(0)
  const [ratingOpen, setRatingOpen] = useState(false)
  return (
    <div className={styles.dinner}>
      <div className={styles.cardText}>
        <span className={styles.cardTitle}>Ужин</span>
        <span className="caption">Water Bar</span>
      </div>
      <div className={styles.glass} aria-hidden="true">
        <i />
      </div>
      <div className={styles.rateRow}>
        <AnimatePresence mode="popLayout" initial={false}>
          {ratingOpen ? (
            <motion.div
              key="stars"
              className={styles.stars}
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
                  aria-label={`Оценка ${n}`}
                  onClick={() => {
                    setRating(n)
                    window.setTimeout(() => setRatingOpen(false), 450)
                  }}
                >
                  <motion.span
                    animate={{ scale: n <= rating ? [1, 1.35, 1] : 1, color: n <= rating ? '#f5b83d' : '#d9d9de' }}
                    transition={{ duration: 0.3, delay: n * 0.03 }}
                  >
                    <StarIcon size={18} />
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
              <Pill small tone="white" onClick={() => setRatingOpen(true)}>
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
  )
}

const CATEGORIES = [
  { id: 'study', icon: CapIcon, label: 'Учёба' },
  { id: 'sport', icon: DumbbellIcon, label: 'Спорт' },
  { id: 'work', icon: BriefcaseIcon, label: 'Работа' },
]

function PrepCard() {
  const [active, setActive] = useState('work')
  return (
    <div className={styles.prep}>
      <div className={styles.cardText}>
        <span className={styles.cardTitle}>Подготовка к встрече</span>
        <span className="caption">Бренд-команда</span>
      </div>
      <div className={styles.segment} role="tablist" aria-label="Категория">
        {CATEGORIES.map(({ id, icon: Icon, label }) => (
          <Pressable
            key={id}
            role="tab"
            aria-selected={active === id}
            aria-label={label}
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
