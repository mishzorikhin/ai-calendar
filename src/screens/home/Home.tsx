import { AnimatePresence, m } from 'framer-motion'
import { Suspense, lazy, useEffect, useState } from 'react'
import { useApi } from '../../api/provider'
import { useDayEvents, useMe, useNotifications, useTasks } from '../../api/queries'
import { useSession } from '../../api/session'
import { BarSlot } from '../../app/bar'
import { useCalendar } from '../../app/calendar'
import { useComposer } from '../../app/composer'
import { useNavigation } from '../../app/navigation'
import { TapToSay } from '../../components/BottomBar'
import { ArrowRightIcon, CalendarIcon, PlusIcon, SlidersIcon } from '../../components/Icons'
import { Sheet } from '../../components/Sheet'
import { Avatar, CircleButton, Pill, Pressable } from '../../components/ui'
import type { DatedEvent, Task } from '../../domain/types'
import { MONTHS_GENITIVE, MONTHS_SHORT, WEEKDAYS, addDays, pad2, startOfDay } from '../../lib/dates'
import { minutesOf, useNow } from '../../lib/hooks'
import { itemVariants } from '../../lib/motion'
import { pluralize } from '../../lib/plural'
import { InstallBanner } from '../../pwa/InstallBanner'
import { userColor, userInitials } from './avatar'
import { clearOAuthReturn, readOAuthReturn } from './calendars/oauthReturn'
import { NextEvent } from './NextEvent'
import { PrepCard } from './PrepCard'
import { TaskSheet } from './TaskSheet'
import { TasksGrid } from './TasksGrid'
import styles from './Home.module.css'

// Шторки аккаунта открываются редко — их код грузится по первому открытию.
const AccountSheet = lazy(() => import('./AccountSheet').then((mod) => ({ default: mod.AccountSheet })))
const CalendarsSheet = lazy(() => import('./calendars/CalendarsSheet').then((mod) => ({ default: mod.CalendarsSheet })))
const RemindersSheet = lazy(() => import('./reminders/RemindersSheet').then((mod) => ({ default: mod.RemindersSheet })))

export function Home() {
  const { go } = useNavigation()
  const { setSelectedDate } = useCalendar()
  const composer = useComposer()
  const api = useApi()
  const session = useSession()
  const me = useMe()
  const { unread } = useNotifications()
  const [taskSheet, setTaskSheet] = useState<Task | 'new' | null>(null)
  // Вернулись со страницы входа Google/Microsoft — сразу открываем «Календари» с результатом.
  const [oauthReturn] = useState(readOAuthReturn)
  const [sheet, setSheet] = useState<'account' | 'calendars' | 'reminders' | null>(oauthReturn ? 'calendars' : null)
  useEffect(clearOAuthReturn, [])
  const user = me.data ?? session?.user
  // Обновляем раз в минуту: «Далее» и дата не застывают, даже если экран долго открыт.
  const now = useNow()
  const today = startOfDay(now)

  const openDay = (d: Date) => {
    setSelectedDate(d)
    go('day')
  }

  const tomorrow = addDays(today, 1)
  const todays = useDayEvents(today).events
  const tomorrows = useDayEvents(tomorrow).events
  const upcoming = todays.find((e) => e.end > minutesOf(now))
  const next: DatedEvent | undefined = upcoming
    ? { ...upcoming, date: today }
    : tomorrows[0]
      ? { ...tomorrows[0], date: tomorrow }
      : undefined
  const { tasks, isError: tasksFailed, refetch: refetchTasks } = useTasks()
  const openTasks = tasks.filter((t) => !t.done).length

  return (
    <Sheet>
      <BarSlot id="say">
        <TapToSay />
      </BarSlot>

      <m.header variants={itemVariants} className={styles.top}>
        <Pressable className={styles.todayLink} scale={0.97} onClick={() => openDay(today)}>
          <span className={styles.todayLabel}>
            {WEEKDAYS[today.getDay()]}, {today.getDate()} {MONTHS_GENITIVE[today.getMonth()]}
          </span>
          <span className={styles.todayHint}>
            Открыть день <ArrowRightIcon size={13} strokeWidth={2.2} />
          </span>
        </Pressable>
        <div className={styles.topRight}>
          {api.mode === 'local' && (
            <CircleButton tone="white" size={44} onClick={() => setSheet('account')} aria-label="Настройки">
              <SlidersIcon size={19} />
            </CircleButton>
          )}
          {api.mode === 'server' && user && (
            <Pressable
              className={styles.accountBtn}
              onClick={() => setSheet('account')}
              aria-label={unread > 0 ? `Аккаунт, ${unread} новых уведомлений` : 'Аккаунт'}
            >
              <Avatar initials={userInitials(user)} color={userColor(user.username)} size={40} ring={false} />
              {unread > 0 && <i className={styles.accountDot} />}
            </Pressable>
          )}
          <Pressable className={styles.dateChip} onClick={() => go('month')} aria-label="Календарь на месяц">
            <span className={`${styles.dateNum} tnum`}>{pad2(today.getDate())}</span>
            <span className={styles.dateMonth}>{MONTHS_SHORT[today.getMonth()]}</span>
            <span className={styles.dateBadge}>
              <CalendarIcon size={12} strokeWidth={2.2} />
            </span>
          </Pressable>
        </div>
      </m.header>

      <m.section variants={itemVariants} className={styles.goals}>
        <div className={styles.goalsHead}>
          <div>
            <h1 className={`display ${styles.goalsTitle}`}>Сегодня</h1>
            <p className="caption">{pluralize(todays.length, ['событие', 'события', 'событий'])} в календаре</p>
          </div>
        </div>
        {next ? (
          <NextEvent event={next} onOpen={() => openDay(next.date)} />
        ) : (
          <Pressable className={styles.free} scale={0.98} onClick={() => composer.open({ date: today })}>
            <span className={`title ${styles.meetingTitle}`}>Свободный день</span>
            <span className={styles.meetingSub}>Нажмите, чтобы что-нибудь запланировать</span>
          </Pressable>
        )}
      </m.section>

      <InstallBanner />

      <m.div variants={itemVariants} className={styles.label}>
        <span>Задачи и цели{tasksFailed ? ' · не загрузились' : tasks.length > 0 ? ` · ${openTasks}` : ''}</span>
        <Pressable className={styles.labelAdd} aria-label="Добавить задачу" onClick={() => setTaskSheet('new')}>
          <PlusIcon size={15} strokeWidth={2.4} />
        </Pressable>
      </m.div>

      {tasksFailed ? (
        <m.div variants={itemVariants} className={styles.failCard}>
          <span className={`title ${styles.failTitle}`}>Задачи не загрузились</span>
          <span className={styles.meetingSub}>Проверьте соединение и попробуйте ещё раз</span>
          <Pill tone="dark" small className={styles.failRetry} onClick={() => void refetchTasks()}>
            Повторить
          </Pill>
        </m.div>
      ) : tasks.length === 0 ? (
        <m.div variants={itemVariants}>
          <Pressable className={styles.free} scale={0.98} onClick={() => setTaskSheet('new')}>
            <span className={`title ${styles.meetingTitle}`}>Задач пока нет</span>
            <span className={styles.meetingSub}>Нажмите, чтобы добавить — или попросите ассистента</span>
          </Pressable>
        </m.div>
      ) : (
        <>
          <TasksGrid onEdit={setTaskSheet} />
          <m.div variants={itemVariants}>
            <PrepCard onEdit={setTaskSheet} />
          </m.div>
        </>
      )}

      <AnimatePresence>
        {taskSheet && (
          <TaskSheet
            key="task-sheet"
            task={taskSheet === 'new' ? undefined : taskSheet}
            onClose={() => setTaskSheet(null)}
          />
        )}
        {sheet === 'account' && (
          <Suspense key="account-sheet" fallback={null}>
            <AccountSheet
              onClose={() => setSheet(null)}
              onCalendars={() => setSheet('calendars')}
              onReminders={() => setSheet('reminders')}
            />
          </Suspense>
        )}
        {sheet === 'reminders' && (
          <Suspense key="reminders-sheet" fallback={null}>
            <RemindersSheet onClose={() => setSheet(null)} />
          </Suspense>
        )}
        {sheet === 'calendars' && (
          <Suspense key="calendars-sheet" fallback={null}>
            <CalendarsSheet notice={oauthReturn} onClose={() => setSheet(null)} />
          </Suspense>
        )}
      </AnimatePresence>
    </Sheet>
  )
}
