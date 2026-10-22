import { apiErrorText } from '../../../api/api'
import { useEndSessions, useExportData, useSessions } from '../../../api/queries'
import { BottomSheet } from '../../../components/BottomSheet'
import { CloseIcon, DeviceIcon, DownloadIcon } from '../../../components/Icons'
import { CircleButton, Pill } from '../../../components/ui'
import { useNow } from '../../../lib/hooks'
import { agoLabel } from '../../../lib/plural'
import { DeleteAccount } from './DeleteAccount'
import { PasswordForm } from './PasswordForm'
import styles from './Account.module.css'

/** «Безопасность и данные»: пароль, устройства со входом, выгрузка данных и удаление аккаунта. */
export function SecuritySheet({ onClose }: { onClose: () => void }) {
  const now = useNow()
  const { sessions, isError } = useSessions()
  const end = useEndSessions()
  const exportData = useExportData()
  const others = sessions.filter((s) => !s.current).length

  const download = () =>
    exportData.mutate(undefined, {
      onSuccess: (json) => {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
        const a = document.createElement('a')
        a.href = url
        a.download = 'ai-calendar.json'
        a.click()
        URL.revokeObjectURL(url)
      },
    })

  return (
    <BottomSheet label="Безопасность и данные" onClose={onClose}>
      <div className={styles.head}>
        <h2>Безопасность и данные</h2>
        <CircleButton tone="gray" size={44} onClick={onClose} aria-label="Закрыть">
          <CloseIcon size={18} />
        </CircleButton>
      </div>

      <p className={styles.label}>Пароль</p>
      <PasswordForm />

      <p className={styles.label}>Где выполнен вход</p>
      {isError && <p className={styles.error}>Не удалось загрузить список устройств</p>}
      <ul className={styles.devices}>
        {sessions.map((s) => (
          <li key={s.id} className={styles.device}>
            <span className={styles.deviceIcon}>
              <DeviceIcon size={18} />
            </span>
            <span className={styles.deviceText}>
              <span className={styles.deviceName}>{s.label || 'Неизвестное устройство'}</span>
              <span className={styles.deviceSub}>
                {s.current ? 'Это устройство' : `Заходили ${agoLabel(new Date(s.lastSeen), now)}`}
              </span>
            </span>
            {!s.current && (
              <Pill small tone="ghost" onClick={() => end.mutate(s.id)} disabled={end.isPending}>
                Выйти
              </Pill>
            )}
          </li>
        ))}
      </ul>
      {others > 1 && (
        <Pill small tone="ghost" className={styles.wide} onClick={() => end.mutate(null)} disabled={end.isPending}>
          Выйти на всех остальных
        </Pill>
      )}
      {end.error && <p className={styles.error}>{apiErrorText(end.error)}</p>}

      <p className={styles.label}>Мои данные</p>
      <Pill small tone="ghost" className={styles.wide} onClick={download} disabled={exportData.isPending}>
        <DownloadIcon size={16} /> {exportData.isPending ? 'Собираю…' : 'Скачать мои данные'}
      </Pill>
      <p className={styles.hint}>
        Один JSON-файл: события, задачи, чат, память ассистента, люди, настройки. Без паролей и ключей.
      </p>
      {exportData.error && <p className={styles.error}>{apiErrorText(exportData.error)}</p>}

      <DeleteAccount />
    </BottomSheet>
  )
}
