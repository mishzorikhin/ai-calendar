import { AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { apiErrorText } from '../../../api/api'
import { useCreateIntegration, useDiscoverCalDav } from '../../../api/queries'
import { Pill } from '../../../components/ui'
import type { CalDavCalendar } from '../../../domain/types'
import { CalendarPicker } from './CalendarPicker'
import { Field } from './Field'
import { CALDAV_PRESETS, type CalDavPresetId } from './labels'
import styles from './Calendars.module.css'

/**
 * Подключение CalDAV в два шага: логин и пароль приложения → выбор календарей.
 * Пароль уходит на сервер и хранится там зашифрованным.
 */
export function CalDavForm({ onDone }: { onDone: (message: string) => void }) {
  const [preset, setPreset] = useState<CalDavPresetId>('yandex')
  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [calendars, setCalendars] = useState<CalDavCalendar[] | null>(null)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const discover = useDiscoverCalDav()
  const create = useCreateIntegration()

  const current = CALDAV_PRESETS.find((p) => p.id === preset) ?? CALDAV_PRESETS[0]
  const url = current.url || server.trim()
  const canSearch = url !== '' && username.trim() !== '' && password !== ''

  const search = () => {
    setConnectError(null)
    discover.mutate(
      { url, username: username.trim(), password },
      {
        onSuccess: (found) => {
          setCalendars(found)
          // Записываемые календари отмечаем сразу: обычно нужен «основной».
          setPicked(
            new Set(
              found
                .filter((c) => c.writable)
                .slice(0, 1)
                .map((c) => c.url),
            ),
          )
        },
      },
    )
  }

  // Любая правка данных входа сбрасывает найденные календари — их надо искать заново.
  const edit = (set: (v: string) => void) => (v: string) => {
    set(v)
    setCalendars(null)
  }

  const toggle = (calUrl: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(calUrl)) next.delete(calUrl)
      else next.add(calUrl)
      return next
    })

  const connect = async () => {
    if (!calendars) return
    setConnecting(true)
    setConnectError(null)
    const done: string[] = []
    try {
      for (const cal of calendars.filter((c) => picked.has(c.url))) {
        await create.mutateAsync({
          kind: 'caldav',
          url: cal.url,
          name: cal.name,
          username: username.trim(),
          password,
          writable: cal.writable,
        })
        done.push(`«${cal.name}»`)
      }
      onDone(done.length === 1 ? `Подключили ${done[0]}` : `Подключили: ${done.join(', ')}`)
    } catch (err) {
      setConnectError(apiErrorText(err))
    } finally {
      setConnecting(false)
    }
  }

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault()
        if (!calendars && canSearch) search()
        else if (calendars && picked.size > 0) void connect()
      }}
    >
      <div className={styles.presets} role="radiogroup" aria-label="Сервис">
        {CALDAV_PRESETS.map((p) => (
          <Pill
            key={p.id}
            small
            role="radio"
            aria-checked={preset === p.id}
            tone={preset === p.id ? 'dark' : 'ghost'}
            onClick={() => {
              setPreset(p.id)
              setCalendars(null)
            }}
          >
            {p.label}
          </Pill>
        ))}
      </div>
      <p className={styles.hint}>{current.hint}</p>

      {!current.url && (
        <Field
          id="caldav-server"
          label="Адрес сервера"
          value={server}
          onValue={edit(setServer)}
          placeholder="https://cloud.example.com/remote.php/dav"
          inputMode="url"
          plain
        />
      )}
      <Field
        id="caldav-login"
        label={current.login}
        value={username}
        onValue={edit(setUsername)}
        autoComplete="off"
        plain
      />
      <Field
        id="caldav-password"
        label="Пароль приложения"
        type="password"
        value={password}
        onValue={edit(setPassword)}
        autoComplete="off"
      />

      <AnimatePresence initial={false}>
        {calendars && <CalendarPicker key="calendars" calendars={calendars} picked={picked} onToggle={toggle} />}
      </AnimatePresence>

      {(discover.error || connectError) && (
        <p className={styles.error} role="alert">
          {connectError ?? apiErrorText(discover.error)}
        </p>
      )}

      {calendars ? (
        <Pill tone="dark" type="submit" className={styles.submit} disabled={picked.size === 0 || connecting}>
          {connecting ? 'Подключаю…' : picked.size > 1 ? `Подключить ${picked.size}` : 'Подключить'}
        </Pill>
      ) : (
        <Pill tone="dark" type="submit" className={styles.submit} disabled={!canSearch || discover.isPending}>
          {discover.isPending ? 'Ищу календари…' : 'Найти календари'}
        </Pill>
      )}
    </form>
  )
}
