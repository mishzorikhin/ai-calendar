import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from '../api/provider'
import { disablePush, enablePush, pushSupport, syncPush, type PushSupport } from '../api/push'
import { keys, usePush } from '../api/queries'
import { useSession } from '../api/session'

export type PushDevice = { support: PushSupport; enabled: boolean; permission: NotificationPermission | null }

/**
 * Уведомления на этом устройстве. При первом чтении сверяет подписку браузера с сервером
 * (syncPush), поэтому хук стоит вызывать в корне приложения — сверка пройдёт при запуске.
 */
export function usePushDevice() {
  const api = useApi()
  const qc = useQueryClient()
  const session = useSession()
  const userId = session?.user.id
  const { data: push } = usePush()
  const publicKey = push?.publicKey ?? null

  const device = useQuery({
    queryKey: keys.pushDevice(userId),
    enabled: api.mode === 'server' && userId !== undefined && publicKey !== null,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<PushDevice> => {
      const support = await pushSupport()
      const permission = typeof Notification === 'undefined' ? null : Notification.permission
      if (support !== 'ok' || !publicKey || userId === undefined) return { support, enabled: false, permission }
      const enabled = await syncPush(api, publicKey, userId).catch(() => false)
      return { support, enabled, permission }
    },
  })

  const afterChange = (enabled: boolean) => {
    qc.setQueryData<PushDevice>(keys.pushDevice(userId), (d) =>
      d ? { ...d, enabled, permission: typeof Notification === 'undefined' ? null : Notification.permission } : d,
    )
    void qc.invalidateQueries({ queryKey: keys.push })
  }

  const enable = useMutation({
    mutationFn: async () => {
      if (!publicKey || userId === undefined) throw new Error('Уведомления работают только с сервером')
      await enablePush(api, publicKey, userId)
    },
    onSuccess: () => afterChange(true),
    // Отказ в разрешении тоже меняет состояние: показываем подсказку про настройки браузера.
    onError: () => afterChange(false),
  })

  const disable = useMutation({
    mutationFn: () => disablePush(api),
    onSuccess: () => afterChange(false),
  })

  return { device: device.data, isLoading: device.isLoading, enable, disable }
}
