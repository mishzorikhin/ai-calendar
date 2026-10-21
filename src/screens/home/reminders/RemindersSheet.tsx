import { apiErrorText } from '../../../api/api'
import { usePush, useUpdateNotifySettings } from '../../../api/queries'
import { BottomSheet } from '../../../components/BottomSheet'
import { CloseIcon } from '../../../components/Icons'
import { CircleButton } from '../../../components/ui'
import {
  DAY_TIME_PRESETS,
  DEFAULT_NOTIFY_SETTINGS,
  REMINDER_PRESETS,
  dayTimeLabel,
  reminderShortLabel,
} from '../../../domain/reminders'
import type { NotifySettings } from '../../../domain/types'
import { ChoiceRow } from './ChoiceRow'
import { DeviceSwitch } from './DeviceSwitch'
import styles from './Reminders.module.css'

const EVENT_CHOICES = [-1, ...REMINDER_PRESETS]
const TASK_CHOICES = [-1, ...DAY_TIME_PRESETS.filter((m) => m >= 8 * 60)]
const DIGEST_CHOICES = [-1, ...DAY_TIME_PRESETS.filter((m) => m <= 10 * 60)]

const timeLabel = (m: number) => (m < 0 ? 'Нет' : dayTimeLabel(m))

/** Шторка «Напоминания»: уведомления на этом устройстве и когда напоминать (для всего аккаунта). */
export function RemindersSheet({ onClose }: { onClose: () => void }) {
  const { data: push, isError } = usePush()
  const update = useUpdateNotifySettings()
  const settings = push?.settings ?? DEFAULT_NOTIFY_SETTINGS
  const set = (patch: Partial<NotifySettings>) => update.mutate(patch)

  return (
    <BottomSheet label="Напоминания" onClose={onClose}>
      <div className={styles.head}>
        <h2>Напоминания</h2>
        <CircleButton tone="gray" size={44} onClick={onClose} aria-label="Закрыть">
          <CloseIcon size={18} />
        </CircleButton>
      </div>
      <p className={styles.lead}>
        Уведомления о встречах и сроках задач придут, даже когда приложение закрыто. Шлёт их ваш сервер — без сторонних
        аккаунтов.
      </p>

      <DeviceSwitch devices={push?.devices ?? 0} />

      <p className={styles.label}>Когда напоминать — на всех устройствах</p>
      <ChoiceRow
        title="О встречах"
        hint="Если у события не задано своё напоминание. И для подключённых календарей"
        options={EVENT_CHOICES}
        value={settings.eventReminder}
        label={reminderShortLabel}
        onChange={(eventReminder) => set({ eventReminder })}
      />
      <ChoiceRow
        title="О задачах и целях"
        hint="В день срока, если ещё не готово"
        options={TASK_CHOICES}
        value={settings.taskTime}
        label={timeLabel}
        onChange={(taskTime) => set({ taskTime })}
      />
      <ChoiceRow
        title="План на день"
        hint="Утром: сколько встреч и задач сегодня. В пустой день не приходит"
        options={DIGEST_CHOICES}
        value={settings.digest}
        label={timeLabel}
        onChange={(digest) => set({ digest })}
      />
      {(update.error || isError) && (
        <p className={styles.error} role="alert">
          {update.error ? apiErrorText(update.error) : 'Настройки не загрузились — проверьте соединение'}
        </p>
      )}
    </BottomSheet>
  )
}
