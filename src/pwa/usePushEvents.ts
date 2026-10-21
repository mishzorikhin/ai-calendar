import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useApi } from '../api/provider'
import { keys } from '../api/queries'
import { usePushDevice } from './usePushDevice'

/** Перейти по адресу из уведомления (`/#day/2026-10-21`) без перезагрузки: маршрут и день читаются из хэша. */
export function openFromNotification(url: string): void {
  const hash = new URL(url, window.location.href).hash || '#home'
  if (window.location.hash === hash) return
  window.history.pushState(null, '', hash)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/**
 * Уведомления в открытом приложении: при запуске сверяет подписку устройства с сервером,
 * по нажатию на уведомление открывает нужный экран, после «Готово» в уведомлении обновляет задачи.
 */
export function usePushEvents(): void {
  const api = useApi()
  const qc = useQueryClient()
  usePushDevice()

  useEffect(() => {
    if (api.mode !== 'server' || !('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: unknown; url?: unknown } | null
      if (data?.type === 'push:open' && typeof data.url === 'string') openFromNotification(data.url)
      if (data?.type === 'push:changed') void qc.invalidateQueries({ queryKey: keys.tasks })
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [api, qc])
}
