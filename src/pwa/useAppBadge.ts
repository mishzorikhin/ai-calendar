import { useEffect } from 'react'
import { useApi } from '../api/provider'
import { useDayEvents, useTasks } from '../api/queries'
import { minutesOf, useNow } from '../lib/hooks'
import { startOfDay, toISODate } from '../lib/dates'

type BadgeNavigator = Navigator & { setAppBadge?(n?: number): Promise<void>; clearAppBadge?(): Promise<void> }

/**
 * Число на иконке приложения: встречи, которые сегодня ещё впереди, и незакрытые задачи
 * со сроком сегодня или раньше — так же считает сервер для push. Badging API есть у PWA
 * на iPhone (с разрешением на уведомления) и в Chrome на компьютере; где его нет — ничего.
 */
export function useAppBadge(): void {
  const api = useApi()
  const now = useNow()
  const today = startOfDay(now)
  const { events } = useDayEvents(today, { keepPrevious: false })
  const { tasks } = useTasks()
  const iso = toISODate(today)
  const minute = minutesOf(now)
  const count =
    events.filter((e) => e.start >= minute).length + tasks.filter((t) => !t.done && !!t.due && t.due <= iso).length

  useEffect(() => {
    if (api.mode !== 'server') return
    const nav = navigator as BadgeNavigator
    const done = count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.()
    done?.catch(() => {})
  }, [api, count])
}
