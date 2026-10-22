import { AnimatePresence } from 'framer-motion'
import { Suspense, lazy, useState, type ReactNode } from 'react'
import { useProfile } from '../../api/queries'
import type { Task } from '../../domain/types'
import type { OAuthReturn } from './calendars/oauthReturn'

// Шторки настроек открываются редко — их код грузится по первому открытию.
const AccountSheet = lazy(() => import('./AccountSheet').then((mod) => ({ default: mod.AccountSheet })))
const CalendarsSheet = lazy(() => import('./calendars/CalendarsSheet').then((mod) => ({ default: mod.CalendarsSheet })))
const RemindersSheet = lazy(() => import('./reminders/RemindersSheet').then((mod) => ({ default: mod.RemindersSheet })))
const ProfileSheet = lazy(() => import('./assistant/ProfileSheet').then((mod) => ({ default: mod.ProfileSheet })))
const MemorySheet = lazy(() => import('./assistant/MemorySheet').then((mod) => ({ default: mod.MemorySheet })))
const SecuritySheet = lazy(() => import('./account/SecuritySheet').then((mod) => ({ default: mod.SecuritySheet })))
const SearchSheet = lazy(() => import('./search/SearchSheet').then((mod) => ({ default: mod.SearchSheet })))
const OnboardingSheet = lazy(() =>
  import('./assistant/OnboardingSheet').then((mod) => ({ default: mod.OnboardingSheet })),
)

export type HomeSheet = 'account' | 'calendars' | 'reminders' | 'profile' | 'memory' | 'search' | 'security'

/** Шторки аккаунта и настроек главной; анкета знакомства открывается сама, пока профиль не заполнен. */
export function HomeSheets({
  sheet,
  onSheet,
  oauthReturn,
  onDay,
  onTask,
}: {
  sheet: HomeSheet | null
  onSheet: (sheet: HomeSheet | null) => void
  oauthReturn: OAuthReturn | null
  /** Открыть день (из поиска). */
  onDay: (date: Date) => void
  /** Открыть задачу (из поиска). */
  onTask: (task: Task) => void
}) {
  const { data: profile } = useProfile()
  // Закрытую анкету не показываем снова, пока сервер подтверждает «пройдено».
  const [onboardingClosed, setOnboardingClosed] = useState(false)
  const close = () => onSheet(null)
  const onboarding = profile && !profile.onboarded && !onboardingClosed && sheet === null

  const lazySheet = (key: string, node: ReactNode) => (
    <Suspense key={key} fallback={null}>
      {node}
    </Suspense>
  )

  return (
    <AnimatePresence>
      {sheet === 'account' &&
        lazySheet(
          'account-sheet',
          <AccountSheet
            onClose={close}
            onCalendars={() => onSheet('calendars')}
            onReminders={() => onSheet('reminders')}
            onProfile={() => onSheet('profile')}
            onMemory={() => onSheet('memory')}
            onSecurity={() => onSheet('security')}
          />,
        )}
      {sheet === 'reminders' && lazySheet('reminders-sheet', <RemindersSheet onClose={close} />)}
      {sheet === 'calendars' && lazySheet('calendars-sheet', <CalendarsSheet notice={oauthReturn} onClose={close} />)}
      {sheet === 'profile' && lazySheet('profile-sheet', <ProfileSheet onClose={close} />)}
      {sheet === 'memory' && lazySheet('memory-sheet', <MemorySheet onClose={close} />)}
      {sheet === 'security' && lazySheet('security-sheet', <SecuritySheet onClose={close} />)}
      {sheet === 'search' &&
        lazySheet(
          'search-sheet',
          <SearchSheet
            onClose={close}
            onDay={(d) => {
              close()
              onDay(d)
            }}
            onTask={(t) => {
              close()
              onTask(t)
            }}
          />,
        )}
      {onboarding &&
        lazySheet('onboarding-sheet', <OnboardingSheet profile={profile} onClose={() => setOnboardingClosed(true)} />)}
    </AnimatePresence>
  )
}
