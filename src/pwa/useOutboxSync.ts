import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'
import { flushOutboxNow, pendingCount, reloadOutbox, subscribePending } from '../api/offline'
import { useApi } from '../api/provider'
import { keys } from '../api/queries'

const RETRY_MS = 30_000

/**
 * Повтор офлайн-очереди мутаций: на старте приложения, по событию online, при появлении
 * новых операций и раз в полминуты, пока очередь не пуста (случай «navigator.onLine есть,
 * а сервер недоступен»). После удачного replay кэши инвалидируются — экран получает
 * серверные данные и настоящие id вместо временных.
 *
 * Service worker тоже может доиграть очередь (Background Sync, приложение закрыто) —
 * тогда он шлёт 'outbox:flushed', а мы перечитываем очередь и данные.
 */
export function useOutboxSync(): number {
  const api = useApi()
  const qc = useQueryClient()

  useEffect(() => {
    if (api.mode !== 'server') return

    const invalidate = () => {
      void qc.invalidateQueries({ queryKey: keys.allEvents })
      void qc.invalidateQueries({ queryKey: keys.allMonths })
      void qc.invalidateQueries({ queryKey: keys.tasks })
    }

    const tick = async () => {
      if (!navigator.onLine || pendingCount() === 0) return
      if (await flushOutboxNow()) invalidate()
    }

    const onOpsChange = () => void tick()
    const onOnline = () => void tick()
    const onSwMessage = (e: MessageEvent) => {
      if ((e.data as { type?: unknown } | null)?.type === 'outbox:flushed') {
        void reloadOutbox().then(invalidate)
      }
    }

    void tick()
    window.addEventListener('online', onOnline)
    const unsub = subscribePending(onOpsChange)
    navigator.serviceWorker?.addEventListener('message', onSwMessage)
    const timer = window.setInterval(() => void tick(), RETRY_MS)

    return () => {
      window.removeEventListener('online', onOnline)
      unsub()
      navigator.serviceWorker?.removeEventListener('message', onSwMessage)
      window.clearInterval(timer)
    }
  }, [api, qc])

  return useSyncExternalStore(subscribePending, pendingCount)
}
