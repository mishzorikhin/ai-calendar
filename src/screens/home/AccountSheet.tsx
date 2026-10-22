import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { apiErrorText } from '../../api/api'
import { useApi } from '../../api/provider'
import {
  useIntegrations,
  useLogout,
  useMarkNotificationsRead,
  useMe,
  useMemories,
  useNotifications,
  usePeople,
  useProfile,
  usePush,
  useUpdateMe,
} from '../../api/queries'
import { useSession } from '../../api/session'
import { useCalendar } from '../../app/calendar'
import { useNavigation } from '../../app/navigation'
import { BottomSheet } from '../../components/BottomSheet'
import { Segmented } from '../../components/Segmented'
import {
  ArrowRightIcon,
  BellIcon,
  BrainIcon,
  CalendarIcon,
  CloseIcon,
  PersonIcon,
  UsersIcon,
} from '../../components/Icons'
import { Avatar, CircleButton, Pressable } from '../../components/ui'
import { userColor, userInitials } from '../../lib/avatar'
import { daysLabel } from '../../domain/profile'
import { reminderLabel } from '../../domain/reminders'
import type { AppNotification } from '../../domain/types'
import { formatMinutes, fromISODate } from '../../lib/dates'
import { pluralize } from '../../lib/plural'
import { useTheme, type ThemeChoice } from '../../lib/theme'
import styles from './Home.module.css'

const THEMES = [
  { id: 'system', label: 'Как в системе' },
  { id: 'light', label: 'Светлое' },
  { id: 'dark', label: 'Тёмное' },
] as const satisfies readonly { id: ThemeChoice; label: string }[]

/**
 * Шторка аккаунта: профиль, оформление, подключённые календари, уведомления о совместных задачах,
 * выход. В локальном режиме (без сервера) — только то, что работает в этом браузере.
 */
export function AccountSheet({
  onClose,
  onCalendars,
  onReminders,
  onProfile,
  onMemory,
}: {
  onClose: () => void
  onCalendars: () => void
  onReminders: () => void
  onProfile: () => void
  onMemory: () => void
}) {
  const api = useApi()
  const server = api.mode === 'server'
  const [theme, setTheme] = useTheme()
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
  const { data: profile } = useProfile()
  const profileSub = !profile
    ? 'Ритм дня, работа, как с вами говорить'
    : profile.workDays.length
      ? `Работа ${daysLabel(profile.workDays)}, ${formatMinutes(profile.workStart)}–${formatMinutes(profile.workEnd)}`
      : 'Без постоянного графика'
  const { memories } = useMemories()
  const { people } = usePeople()
  const memorySub =
    profile && !profile.memory
      ? 'Память выключена'
      : memories.length + people.length === 0
        ? 'Пока ничего — расскажите о себе в чате'
        : [
            memories.length && pluralize(memories.length, ['факт', 'факта', 'фактов']),
            people.length && pluralize(people.length, ['человек', 'человека', 'человек']),
          ]
            .filter(Boolean)
            .join(' · ')
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
    <BottomSheet label={server ? 'Аккаунт' : 'Настройки'} onClose={onClose}>
      <div className={styles.tagSheetHead}>
        <h2>{server ? 'Аккаунт' : 'Настройки'}</h2>
        <CircleButton tone="gray" size={44} onClick={onClose} aria-label="Закрыть">
          <CloseIcon size={18} />
        </CircleButton>
      </div>

      {server && user && (
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

      {!server && <p className={styles.localNote}>Локальный режим: данные хранятся только в этом браузере</p>}

      <Pressable className={styles.settingsRow} scale={0.98} onClick={onProfile}>
        <span className={styles.settingsIcon}>
          <PersonIcon size={19} />
        </span>
        <span className={styles.settingsText}>
          <span className={styles.settingsTitle}>Ассистент обо мне</span>
          <span className={styles.settingsSub}>{profileSub}</span>
        </span>
        <ArrowRightIcon size={16} strokeWidth={2.2} className={styles.settingsArrow} />
      </Pressable>

      <Pressable className={styles.settingsRow} scale={0.98} onClick={onMemory}>
        <span className={styles.settingsIcon}>
          <BrainIcon size={19} />
        </span>
        <span className={styles.settingsText}>
          <span className={styles.settingsTitle}>Что ассистент знает</span>
          <span className={styles.settingsSub}>{memorySub}</span>
        </span>
        <ArrowRightIcon size={16} strokeWidth={2.2} className={styles.settingsArrow} />
      </Pressable>

      <p className={styles.sheetLabel}>Оформление</p>
      <Segmented label="Оформление" options={THEMES} value={theme} onChange={setTheme} />

      {server && (
        <>
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
                <NotificationRow key={n.id} n={n} onOpen={onClose} />
              ))}
            </ul>
          )}
        </>
      )}

      {server && (
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
      )}
    </BottomSheet>
  )
}

/** Уведомление; о встрече — кнопка, которая открывает её день. */
function NotificationRow({ n, onOpen }: { n: AppNotification; onOpen: () => void }) {
  const { go } = useNavigation()
  const { setSelectedDate } = useCalendar()
  const date = n.date
  const cls = `${styles.notif} ${n.read ? '' : styles.notifNew}`
  if (!date) {
    return (
      <li className={cls}>
        <NotificationBody n={n} />
      </li>
    )
  }
  return (
    <li>
      <button
        type="button"
        className={`${cls} ${styles.notifButton}`}
        onClick={() => {
          setSelectedDate(fromISODate(date))
          go('day')
          onOpen()
        }}
      >
        <NotificationBody n={n} />
      </button>
    </li>
  )
}

function NotificationBody({ n }: { n: AppNotification }) {
  return (
    <>
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
    </>
  )
}
