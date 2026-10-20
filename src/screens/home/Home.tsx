import { motion } from 'framer-motion'
import { useActiveBooking, useDayEvents } from '../../api/queries'
import { BarSlot } from '../../app/bar'
import { useCalendar } from '../../app/calendar'
import { useNavigation } from '../../app/navigation'
import { TapToSay } from '../../components/BottomBar'
import { ArrowRightIcon, CalendarIcon } from '../../components/Icons'
import { Sheet } from '../../components/Sheet'
import { PersonAvatar, Pressable, Stack } from '../../components/ui'
import { MONTHS_GENITIVE, MONTHS_SHORT, WEEKDAYS, addDays, pad2, startOfDay } from '../../lib/dates'
import { minutesOf, useNow } from '../../lib/hooks'
import { itemVariants } from '../../lib/motion'
import { pluralize } from '../../lib/plural'
import type { CalendarEvent } from '../../domain/types'
import { FRIEND, ME } from '../../mocks/people'
import { InstallBanner } from '../../pwa/InstallBanner'
import { BookedCard } from './BookedCard'
import { NextEvent } from './NextEvent'
import { PrepCard } from './PrepCard'
import { TasksGrid } from './TasksGrid'
import styles from './Home.module.css'

/** Планы дня — всё, кроме сна. */
const isPlan = (e: CalendarEvent) => e.badge !== 'sleep'

export function Home() {
  const { go } = useNavigation()
  const { setSelectedDate } = useCalendar()
  const booking = useActiveBooking()
  // Обновляем раз в минуту: «Далее» и дата не застывают, даже если экран долго открыт.
  const now = useNow()
  const today = startOfDay(now)

  const openDay = (d: Date) => {
    setSelectedDate(d)
    go('day')
  }

  const tomorrow = addDays(today, 1)
  const todays = useDayEvents(today).events.filter(isPlan)
  const tomorrows = useDayEvents(tomorrow).events.filter(isPlan)
  const upcoming = todays.find((e) => e.end > minutesOf(now))
  const nextDate = upcoming ? today : tomorrow
  const next = upcoming ?? tomorrows[0]

  return (
    <Sheet>
      <BarSlot id="say">
        <TapToSay />
      </BarSlot>

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
            <p className="caption">{pluralize(todays.length, ['событие', 'события', 'событий'])} в календаре</p>
          </div>
          <Stack overlap={9}>
            <PersonAvatar person={FRIEND} size={30} />
            <PersonAvatar person={ME} size={30} />
            <span className={styles.more}>+4</span>
          </Stack>
        </div>
        {next && <NextEvent event={next} date={nextDate} onOpen={() => openDay(nextDate)} />}
      </motion.section>

      <InstallBanner />

      <BookedCard booking={booking} onOpen={openDay} />

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
