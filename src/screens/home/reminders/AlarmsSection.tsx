import { useRef, useState } from 'react'
import { apiErrorText } from '../../../api/api'
import { useAlarms, useCreateAlarm, useDeleteAlarm } from '../../../api/queries'
import { CloseIcon } from '../../../components/Icons'
import { Pill, Pressable } from '../../../components/ui'
import { LIMITS } from '../../../domain/limits'
import { alarmPresets, alarmWhenLabel } from '../../../domain/reminders'
import { useNow } from '../../../lib/hooks'
import styles from './Reminders.module.css'

/** Свои напоминания без события: «Позвонить маме» + когда. Ниже — те, что ещё не пришли. */
export function AlarmsSection() {
  const now = useNow()
  const { alarms } = useAlarms()
  const create = useCreateAlarm()
  const remove = useDeleteAlarm()
  const [text, setText] = useState('')
  const [missing, setMissing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const error = create.error ?? remove.error

  const add = (at: Date) => {
    const value = text.trim()
    if (!value) {
      setMissing(true)
      input.current?.focus()
      return
    }
    create.mutate({ text: value, at }, { onSuccess: () => setText('') })
  }

  return (
    <div className={styles.group}>
      <p className={styles.groupTitle}>Напомнить без события</p>
      <input
        ref={input}
        className={styles.alarmInput}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setMissing(false)
        }}
        maxLength={LIMITS.title}
        placeholder="О чём, например «Позвонить маме»"
        aria-label="О чём напомнить"
        aria-invalid={missing || undefined}
        enterKeyHint="done"
      />
      <p className={styles.groupHint}>{missing ? 'Сначала напишите, о чём напомнить' : 'И выберите когда:'}</p>
      <div className={styles.choices} role="group" aria-label="Когда напомнить">
        {alarmPresets(now).map((p) => (
          <Pill
            key={p.label}
            small
            tone="white"
            className={styles.choice}
            disabled={create.isPending}
            onClick={() => add(p.at)}
          >
            {p.label}
          </Pill>
        ))}
        <label className={styles.alarmTime}>
          Точное время
          <input
            type="time"
            aria-label="Напомнить в точное время"
            onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number)
              if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return
              const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m)
              // Время, которое сегодня уже прошло, — значит, завтра.
              if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1)
              add(at)
              e.target.value = ''
            }}
          />
        </label>
      </div>

      {alarms.length > 0 && (
        <ul className={styles.alarmList}>
          {alarms.map((a) => (
            <li key={a.id} className={styles.alarm}>
              <span className={styles.alarmText}>
                <span className={styles.alarmTitle}>{a.kind === 'reminder' ? a.text : `Отложено: ${a.text}`}</span>
                <span className={styles.alarmWhen}>{alarmWhenLabel(new Date(a.at), now)}</span>
              </span>
              <Pressable
                className={styles.alarmDelete}
                onClick={() => remove.mutate(a.id)}
                aria-label={`Отменить напоминание «${a.text}»`}
              >
                <CloseIcon size={16} />
              </Pressable>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {apiErrorText(error)}
        </p>
      )}
    </div>
  )
}
