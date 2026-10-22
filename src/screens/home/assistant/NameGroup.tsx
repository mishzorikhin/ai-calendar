import { useState } from 'react'
import { apiErrorText } from '../../../api/api'
import { useMe, useUpdateMe } from '../../../api/queries'
import { Group } from './Fields'
import styles from './Assistant.module.css'

/**
 * Как к человеку обращаться. Это имя аккаунта (его же видят в приглашениях); ассистент сохраняет
 * его сам, когда человек называется в чате. Имя по умолчанию — логин, его не показываем как имя.
 */
export function NameGroup() {
  const { data: me } = useMe()
  const update = useUpdateMe()
  const known = me && me.name.toLowerCase() !== me.username.toLowerCase() ? me.name : ''
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? known
  const save = () => {
    const name = value.trim()
    if (name && name !== known) update.mutate(name, { onSuccess: () => setDraft(null) })
    else setDraft(null)
  }

  return (
    <Group title="Как вас зовут" hint="Так ассистент к вам обращается. Можно просто сказать ему в чате">
      <input
        className={styles.input}
        value={value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        placeholder="Имя"
        aria-label="Как вас зовут"
        maxLength={40}
        autoComplete="given-name"
        enterKeyHint="done"
      />
      {update.error && <p className={styles.groupHint}>{apiErrorText(update.error)}</p>}
    </Group>
  )
}
