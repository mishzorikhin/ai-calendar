import { apiErrorText } from '../../../api/api'
import { useTestPush } from '../../../api/queries'
import { Pill, Pressable } from '../../../components/ui'
import { pluralize } from '../../../lib/plural'
import { usePushDevice } from '../../../pwa/usePushDevice'
import styles from './Reminders.module.css'

const DEVICES = ['устройство', 'устройства', 'устройств'] as const

/** Переключатель уведомлений на этом устройстве, подсказки, если они недоступны, и проверка доставки. */
export function DeviceSwitch({ devices }: { devices: number }) {
  const { device, isLoading, enable, disable } = usePushDevice()
  const test = useTestPush()
  const on = device?.enabled ?? false
  const busy = isLoading || enable.isPending || disable.isPending
  const blocked = device?.support !== undefined && device.support !== 'ok'
  const error = enable.error ?? disable.error ?? test.error

  const toggle = () => {
    test.reset()
    if (on) disable.mutate()
    else enable.mutate()
  }

  let note: string
  if (device?.support === 'ios-install')
    note =
      'На iPhone уведомления приходят, если добавить приложение на экран «Домой»: «Поделиться» → «На экран „Домой“»'
  else if (device?.support === 'unsupported') note = 'Этот браузер не умеет показывать уведомления'
  else if (device?.support === 'no-worker')
    note = 'Уведомления работают в установленном приложении, а не в режиме разработки'
  else if (device?.permission === 'denied')
    note = 'Уведомления запрещены в настройках браузера — разрешите их для этого сайта'
  else if (test.data !== undefined) note = `Отправили на ${pluralize(test.data, DEVICES)} — сейчас придёт`
  else if (on) note = devices > 1 ? `Включены ещё на ${pluralize(devices - 1, DEVICES)}` : 'Включены на этом устройстве'
  else note = devices > 0 ? `Включены на ${pluralize(devices, DEVICES)}, но не здесь` : 'Сейчас выключены'

  return (
    <div className={styles.device}>
      <Pressable
        className={styles.switchRow}
        scale={0.98}
        role="switch"
        aria-checked={on}
        disabled={busy || blocked}
        onClick={toggle}
      >
        Уведомления на этом устройстве
        <span className={`${styles.switch} ${on ? styles.switchOn : ''}`} aria-hidden="true" />
      </Pressable>
      <div className={styles.deviceNote}>
        <p role="status" className={error ? styles.deviceNoteError : undefined}>
          {error ? apiErrorText(error) : note}
        </p>
        {on && (
          <Pill small tone="white" disabled={test.isPending} onClick={() => test.mutate()}>
            Проверить
          </Pill>
        )}
      </div>
    </div>
  )
}
