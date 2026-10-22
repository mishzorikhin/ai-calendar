import { useState } from 'react'
import { ArrowRightIcon } from '../../../components/Icons'
import { Avatar, Pill } from '../../../components/ui'
import { memoryDateLabel } from '../../../domain/profile'
import type { Person } from '../../../domain/types'
import { userColor, userInitials } from '../../../lib/avatar'
import { PersonForm } from './PersonForm'
import styles from './Assistant.module.css'

/** Люди: список карточек, по нажатию — форма. */
export function PeopleTab({ people }: { people: Person[] }) {
  const [editing, setEditing] = useState<Person | 'new' | null>(null)
  if (editing) {
    return (
      <PersonForm
        key={editing === 'new' ? 'new' : editing.id}
        person={editing === 'new' ? undefined : editing}
        onDone={() => setEditing(null)}
      />
    )
  }
  return (
    <>
      <Pill small tone="ghost" className={styles.addBtn} onClick={() => setEditing('new')}>
        + Добавить человека
      </Pill>
      {people.length === 0 ? (
        <p className={styles.empty}>
          Расскажите ассистенту, кто есть кто: «Глеб — мой коллега, обычно видимся в кофейне на Ленина». Тогда «встреча
          с Глебом» сразу получит место и длительность.
        </p>
      ) : (
        <ul className={styles.list}>
          {people.map((p) => {
            const sub = [p.relation, p.place, p.birthday && `ДР ${memoryDateLabel(p.birthday)}`]
              .filter(Boolean)
              .join(' · ')
            return (
              <li key={p.id}>
                <button type="button" className={`${styles.row} ${styles.personRow}`} onClick={() => setEditing(p)}>
                  <Avatar
                    initials={userInitials({ name: p.name, username: p.username ?? p.name })}
                    color={userColor(p.username ?? p.name)}
                    size={38}
                    ring={false}
                  />
                  <span className={styles.rowText}>
                    <span className={styles.rowTitle}>{p.name}</span>
                    {sub && <span className={styles.rowSub}>{sub}</span>}
                  </span>
                  <ArrowRightIcon size={16} strokeWidth={2.2} className={styles.rowArrow} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
