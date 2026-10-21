import { useQuery } from '@tanstack/react-query'
import { apiErrorText } from '../../../api/api'
import { currentDeviceId } from '../../../api/push'
import { keys, useDeleteDevice, useDevices } from '../../../api/queries'
import { Pill } from '../../../components/ui'
import { relativeDayLabel } from '../../../lib/dates'
import { usePushDevice } from '../../../pwa/usePushDevice'
import styles from './Reminders.module.css'

/** Устройства с уведомлениями: старый телефон можно отключить отсюда. */
export function DevicesList() {
  const { data: devices = [] } = useDevices()
  const remove = useDeleteDevice()
  const { disable } = usePushDevice()
  // Своё устройство находим по тому же хэшу адреса подписки, что считает сервер.
  const { data: mine } = useQuery({ queryKey: keys.pushDeviceId, queryFn: currentDeviceId, staleTime: Infinity })
  const error = remove.error ?? disable.error
  if (devices.length === 0) return null

  return (
    <>
      <p className={styles.label}>Устройства с уведомлениями</p>
      <ul className={styles.deviceList}>
        {devices.map((d) => {
          const current = d.id === mine
          return (
            <li key={d.id} className={styles.deviceRow}>
              <span className={styles.alarmText}>
                <span className={styles.alarmTitle}>{d.label}</span>
                <span className={styles.alarmWhen}>
                  {current ? 'Это устройство · ' : ''}добавлено {relativeDayLabel(new Date(d.createdAt)).toLowerCase()}
                </span>
              </span>
              <Pill
                small
                tone="white"
                disabled={remove.isPending || disable.isPending}
                // Своё отключаем целиком — и подписку браузера, а не только запись на сервере.
                onClick={() => (current ? disable.mutate() : remove.mutate(d.id))}
              >
                Отключить
              </Pill>
            </li>
          )
        })}
      </ul>
      {error && (
        <p className={styles.error} role="alert">
          {apiErrorText(error)}
        </p>
      )}
    </>
  )
}
