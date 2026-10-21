import { apiErrorText } from '../../../api/api'
import { usePush, useUpdateNotifySettings } from '../../../api/queries'
import { BottomSheet } from '../../../components/BottomSheet'
import { CloseIcon } from '../../../components/Icons'
import { CircleButton } from '../../../components/ui'
import {
  DAY_TIME_PRESETS,
  DEFAULT_NOTIFY_SETTINGS,
  QUIET_PRESETS,
  REMINDER_PRESETS,
  dayTimeLabel,
  decodeQuiet,
  encodeQuiet,
  quietLabel,
  reminderShortLabel,
} from '../../../domain/reminders'
import type { NotifySettings } from '../../../domain/types'
import { AlarmsSection } from './AlarmsSection'
import { BadgeDefaults } from './BadgeDefaults'
import { ChoiceRow } from './ChoiceRow'
import { DevicesList } from './DevicesList'
import { DeviceSwitch } from './DeviceSwitch'
import styles from './Reminders.module.css'

const EVENT_CHOICES = [-1, ...REMINDER_PRESETS]
const TASK_CHOICES = [-1, ...DAY_TIME_PRESETS.filter((m) => m >= 8 * 60)]
const DIGEST_CHOICES = [-1, ...DAY_TIME_PRESETS.filter((m) => m <= 10 * 60)]
const EVENING_CHOICES = [-1, 19 * 60, 20 * 60, 21 * 60, 22 * 60]
const QUIET_CHOICES = [-1, ...QUIET_PRESETS.map(([from, to]) => encodeQuiet(from, to))]

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
      <AlarmsSection />

      <p className={styles.label}>Когда напоминать — на всех устройствах</p>
      <ChoiceRow
        title="О встречах"
        hint="Если у события не задано своё напоминание. И для подключённых календарей"
        options={EVENT_CHOICES}
        value={settings.eventReminder}
        label={reminderShortLabel}
        onChange={(eventReminder) => set({ eventReminder })}
      >
        <BadgeDefaults settings={settings} onChange={(badgeReminders) => set({ badgeReminders })} />
      </ChoiceRow>
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
      <ChoiceRow
        title="План на завтра"
        hint="Вечером: что ждёт завтра"
        options={EVENING_CHOICES}
        value={settings.evening}
        label={timeLabel}
        onChange={(evening) => set({ evening })}
      />
      <ChoiceRow
        title="Тихие часы"
        hint="Ничего не приходит, кроме напоминаний, заданных у события явно, и своих напоминаний"
        options={QUIET_CHOICES}
        value={encodeQuiet(settings.quietFrom, settings.quietTo)}
        label={quietLabel}
        onChange={(code) => set(decodeQuiet(code))}
      />
      {(update.error || isError) && (
        <p className={styles.error} role="alert">
          {update.error ? apiErrorText(update.error) : 'Настройки не загрузились — проверьте соединение'}
        </p>
      )}

      <DevicesList />
    </BottomSheet>
  )
}
