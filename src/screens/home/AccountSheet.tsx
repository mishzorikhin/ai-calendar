import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { apiErrorText } from '../../api/api'
import {
  useIntegrations,
  useLogout,
  useMarkNotificationsRead,
  useMe,
  useNotifications,
  usePush,
  useUpdateMe,
} from '../../api/queries'
import { useSession } from '../../api/session'
import { BottomSheet } from '../../components/BottomSheet'
import { ArrowRightIcon, BellIcon, CalendarIcon, CloseIcon, UsersIcon } from '../../components/Icons'
import { Avatar, CircleButton, Pressable } from '../../components/ui'
import { userColor, userInitials } from './avatar'
import { reminderLabel } from '../../domain/reminders'
import type { AppNotification } from '../../domain/types'
import styles from './Home.module.css'

/** Шторка аккаунта: профиль, подключённые календари, уведомления о совместных задачах, выход. */
export function AccountSheet({
  onClose,
  onCalendars,
  onReminders,
}: {
  onClose: () => void
  onCalendars: () => void
  onReminders: () => void
}) {
  const { data: me } = useMe()
  const session = useSession()
  const user = me ?? session?.user
  const { notifications, unread } = useNotifications()
  const markRead = useMarkNotificationsRead()
  const updateMe = useUpdateMe()
  const logout = useLogout()
  const { info } = useIntegrations()
  const calendarsSub =
    info.items.length > 0 ? info.items.map((i) => i.name).join(', ') : 'Google, Яндекс, iCloud, ссылка .ics'
  const { data: push } = usePush()
  const remindersSub = !push
    ? 'Встречи, сроки задач, план на день'
    : push.devices === 0
      ? 'Выключены — включите на этом устройстве'
      : `О встречах: ${reminderLabel(push.settings.eventReminder).toLowerCase()}`

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(user?.name ?? '')
  const [confirmExit, setConfirmExit] = useState(false)
  const nameField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) nameField.current?.focus()
  }, [editing])

  // Открыли шторку — прочитали уведомления (один раз, по состоянию на момент открытия).
  const readOnOpen = useEffectEvent(() => {
    if (unread > 0) markRead.mutate()
  })
  useEffect(() => readOnOpen(), [])

  const saveName = () => {
    const v = name.trim()
    if (v && v !== user?.name) updateMe.mutate(v, { onSuccess: () => setEditing(false) })
    else setEditing(false)
  }

  const exit = () => {
    if (!confirmExit) {
      setConfirmExit(true)
      return
    }
    logout.mutate()
    onClose()
  }

  return (
    <BottomSheet label="Аккаунт" onClose={onClose}>
      <div className={styles.tagSheetHead}>
        <h2>Аккаунт</h2>
        <CircleButton tone="gray" size={44} onClick={onClose} aria-label="Закрыть">
          <CloseIcon size={18} />
        </CircleButton>
      </div>

      {user && (
        <div className={styles.accountHead}>
          <Avatar initials={userInitials(user)} color={userColor(user.username)} size={56} ring={false} />
          <div className={styles.accountNames}>
            {editing ? (
              <input
                ref={nameField}
                className={styles.nameInput}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveName()}
                onBlur={saveName}
                maxLength={60}
                aria-label="Имя"
              />
            ) : (
              <Pressable
                className={styles.nameBtn}
                onClick={() => {
                  setName(user.name)
                  setEditing(true)
                }}
              >
                <span className={styles.accountName}>{user.name || user.username}</span>
                <span className={styles.nameEdit}>изменить</span>
              </Pressable>
            )}
            <span className="caption">@{user.username}</span>
          </div>
        </div>
      )}

      <Pressable className={styles.settingsRow} scale={0.98} onClick={onCalendars}>
        <span className={styles.settingsIcon}>
          <CalendarIcon size={19} />
        </span>
        <span className={styles.settingsText}>
          <span className={styles.settingsTitle}>Календари</span>
          <span className={styles.settingsSub}>{calendarsSub}</span>
        </span>
        <ArrowRightIcon size={16} strokeWidth={2.2} className={styles.settingsArrow} />
      </Pressable>

      <Pressable className={styles.settingsRow} scale={0.98} onClick={onReminders}>
        <span className={styles.settingsIcon}>
          <BellIcon size={19} />
        </span>
        <span className={styles.settingsText}>
          <span className={styles.settingsTitle}>Напоминания</span>
          <span className={styles.settingsSub}>{remindersSub}</span>
        </span>
        <ArrowRightIcon size={16} strokeWidth={2.2} className={styles.settingsArrow} />
      </Pressable>

      <p className={styles.sheetLabel}>Уведомления{unread > 0 ? ` · ${unread}` : ''}</p>
      {notifications.length === 0 ? (
        <p className={styles.notifEmpty}>Пока пусто — когда с вами поделятся задачей, она появится здесь</p>
      ) : (
        <ul className={styles.notifList}>
          {notifications.map((n) => (
            <NotificationRow key={n.id} n={n} />
          ))}
        </ul>
      )}

      <div className={styles.accountFoot}>
        <Pressable
          className={`${styles.delete} ${confirmExit ? styles.deleteSure : ''}`}
          onClick={exit}
          disabled={logout.isPending}
        >
          {confirmExit ? 'Точно выйти?' : 'Выйти из аккаунта'}
        </Pressable>
        {logout.error && <p className={styles.sheetError}>{apiErrorText(logout.error)}</p>}
      </div>
    </BottomSheet>
  )
}

function NotificationRow({ n }: { n: AppNotification }) {
  return (
    <li className={`${styles.notif} ${n.read ? '' : styles.notifNew}`}>
      <span className={styles.notifIcon}>
        {n.from ? (
          <Avatar initials={userInitials(n.from)} color={userColor(n.from.username)} size={34} ring={false} />
        ) : (
          <UsersIcon size={17} />
        )}
      </span>
      <span className={styles.notifBody}>
        <span className={styles.notifText}>{n.text}</span>
        <span className={styles.notifMeta}>
          {n.from ? `@${n.from.username} · ` : ''}
          {n.read ? 'прочитано' : 'новое'}
        </span>
      </span>
      {!n.read && <i className={styles.notifDot} aria-label="непрочитанное" />}
    </li>
  )
}
