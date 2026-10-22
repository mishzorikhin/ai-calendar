import { useState } from 'react'
import { apiErrorText } from '../../../api/api'
import { useDeletePerson, useSavePerson } from '../../../api/queries'
import { BackIcon } from '../../../components/Icons'
import { Pill, Pressable } from '../../../components/ui'
import { PROFILE_LIMITS, isMemoryDate, personError } from '../../../domain/profile'
import type { Person, PersonInput } from '../../../domain/types'
import styles from './Assistant.module.css'

const MEETING = [0, 30, 45, 60, 90, 120]

/** «14.03» / «14.03.1990» ↔ «--03-14» / «1990-03-14». */
function toDateInput(v: string | undefined): string {
  if (!v) return ''
  const yearly = /^--(\d{2})-(\d{2})$/.exec(v)
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (yearly) return `${yearly[2]}.${yearly[1]}`
  if (full) return `${full[3]}.${full[2]}.${full[1]}`
  return v
}

function fromDateInput(v: string): string {
  const m = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/.exec(v.trim())
  if (!m) return v.trim()
  const dd = m[1]?.padStart(2, '0')
  const mm = m[2]?.padStart(2, '0')
  return m[3] ? `${m[3]}-${mm}-${dd}` : `--${mm}-${dd}`
}

/** Форма карточки человека: создание и правка, удаление — в правке. */
export function PersonForm({ person, onDone }: { person?: Person; onDone: () => void }) {
  const save = useSavePerson()
  const remove = useDeletePerson()
  const [form, setForm] = useState({
    name: person?.name ?? '',
    aliases: person?.aliases?.join(', ') ?? '',
    relation: person?.relation ?? '',
    place: person?.place ?? '',
    meetingMinutes: person?.meetingMinutes ?? 0,
    birthday: toDateInput(person?.birthday),
    notes: person?.notes ?? '',
    username: person?.username ?? '',
  })
  const [sure, setSure] = useState(false)
  const input: PersonInput = {
    ...form,
    aliases: form.aliases
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean),
    birthday: fromDateInput(form.birthday) || undefined,
  }
  const problem = form.name.trim() ? personError(input) : null
  const field = (key: 'name' | 'relation' | 'place' | 'username', label: string, placeholder: string) => (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        className={styles.input}
        value={form[key]}
        maxLength={PROFILE_LIMITS.personField}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  )

  return (
    <div className={styles.form}>
      <Pressable className={styles.back} onClick={onDone}>
        <BackIcon size={16} /> Все люди
      </Pressable>
      {field('name', 'Имя', 'Глеб')}
      <label className={styles.field}>
        <span>Ещё зовут</span>
        <input
          className={styles.input}
          value={form.aliases}
          placeholder="Глебушка, Г. Петров — через запятую"
          onChange={(e) => setForm({ ...form, aliases: e.target.value })}
        />
      </label>
      {field('relation', 'Кто это', 'Коллега, мама, тренер')}
      {field('place', 'Где обычно видитесь', 'Кофейня на Ленина')}
      <div className={styles.field}>
        <span id="person-meeting">Встреча обычно</span>
        <div className={styles.choices} role="radiogroup" aria-labelledby="person-meeting">
          {MEETING.map((m) => (
            <Pill
              key={m}
              small
              role="radio"
              aria-checked={form.meetingMinutes === m}
              tone={form.meetingMinutes === m ? 'dark' : 'white'}
              className={styles.choice}
              onClick={() => setForm({ ...form, meetingMinutes: m })}
            >
              {m === 0 ? 'Как обычно' : m < 60 ? `${m} мин` : `${m / 60} ч`.replace('.5', ',5')}
            </Pill>
          ))}
        </div>
      </div>
      <label className={styles.field}>
        <span>День рождения</span>
        <input
          className={styles.input}
          value={form.birthday}
          inputMode="numeric"
          placeholder="14.03 или 14.03.1990"
          aria-invalid={form.birthday !== '' && !isMemoryDate(fromDateInput(form.birthday))}
          onChange={(e) => setForm({ ...form, birthday: e.target.value })}
        />
      </label>
      {field('username', 'Логин в приложении', 'gleb — для совместных задач')}
      <label className={styles.field}>
        <span>Заметка</span>
        <textarea
          className={styles.textarea}
          rows={2}
          value={form.notes}
          maxLength={PROFILE_LIMITS.personNotes}
          placeholder="Не пьёт кофе, любит встречи утром"
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </label>

      {(problem || save.error || remove.error) && (
        <p className={styles.error} role="alert">
          {problem ?? apiErrorText(save.error ?? remove.error)}
        </p>
      )}
      <div className={styles.formActions}>
        {person && (
          <Pressable
            className={`${styles.danger} ${sure ? styles.dangerSure : ''}`}
            onClick={() => (sure ? remove.mutate(person.id, { onSuccess: onDone }) : setSure(true))}
          >
            {sure ? 'Точно удалить?' : 'Удалить'}
          </Pressable>
        )}
        <Pill
          small
          tone="dark"
          disabled={!form.name.trim() || !!problem || save.isPending}
          onClick={() => save.mutate({ id: person?.id, input }, { onSuccess: onDone })}
        >
          {person ? 'Сохранить' : 'Добавить'}
        </Pill>
      </div>
    </div>
  )
}
