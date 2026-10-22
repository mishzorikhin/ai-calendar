import { useState } from 'react'
import { useUserSearch } from '../api/queries'
import type { Rsvp, User } from '../domain/types'
import { userColor, userInitials } from '../lib/avatar'
import { CheckIcon, CloseIcon } from './Icons'
import { Avatar, Pressable } from './ui'
import styles from './PeoplePicker.module.css'

export type Picked = { username: string; name?: string; status?: Rsvp }

const STATUS: Record<Rsvp, string> = { pending: 'ждём ответа', accepted: 'придёт', declined: 'не придёт' }

/**
 * Люди сервера: чипы выбранных (с ответом на приглашение, если он есть) и поле «@логин»
 * с подсказками. Себя в подсказках нет — сервер не отдаёт себя в поиске.
 */
export function PeoplePicker({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string
  placeholder: string
  value: readonly Picked[]
  onChange: (next: Picked[]) => void
}) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const q = query.trim().replace(/^@/, '').toLowerCase()
  const { data: found = [] } = useUserSearch(q)
  const taken = new Set(value.map((p) => p.username))
  const suggestions = found.filter((u) => !taken.has(u.username)).slice(0, 5)
  const add = (u: User) => {
    setQuery('')
    onChange([...value, { username: u.username, name: u.name }])
  }

  return (
    <div className={styles.picker}>
      <p className={styles.label}>{label}</p>
      {value.length > 0 && (
        <ul className={styles.chips}>
          {value.map((p) => (
            <li key={p.username} className={styles.chip}>
              <Avatar
                initials={userInitials({ username: p.username, name: p.name ?? '' })}
                color={userColor(p.username)}
                size={26}
                ring={false}
              />
              <span className={styles.chipText}>
                <span>{p.name || `@${p.username}`}</span>
                {p.status && <small className={styles[p.status]}>{STATUS[p.status]}</small>}
              </span>
              <Pressable
                className={styles.remove}
                aria-label={`Убрать @${p.username}`}
                onClick={() => onChange(value.filter((x) => x.username !== p.username))}
              >
                <CloseIcon size={12} strokeWidth={2.4} />
              </Pressable>
            </li>
          ))}
        </ul>
      )}
      {/* Подсказки открыты, пока фокус внутри поля или списка. */}
      <div
        className={styles.inputWrap}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setFocused(false)
        }}
      >
        <input
          className={styles.input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            const first = suggestions[0]
            if (e.key === 'Enter' && first) {
              e.preventDefault()
              add(first)
            }
            if (e.key === 'Escape' && query) {
              e.stopPropagation()
              setQuery('')
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
        />
        {focused && suggestions.length > 0 && (
          <ul className={styles.drop} role="listbox" onMouseDown={(e) => e.preventDefault()}>
            {suggestions.map((u) => (
              <li key={u.id}>
                <Pressable className={styles.option} onClick={() => add(u)} role="option" aria-selected="false">
                  <Avatar initials={userInitials(u)} color={userColor(u.username)} size={28} ring={false} />
                  <span className={styles.optionText}>
                    <span>{u.name || u.username}</span>
                    <span className="caption">@{u.username}</span>
                  </span>
                  <CheckIcon size={15} className={styles.pick} />
                </Pressable>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
