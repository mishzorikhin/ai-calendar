import { useState } from 'react'
import { apiErrorText } from '../../../api/api'
import { useCreateIntegration } from '../../../api/queries'
import { Pill } from '../../../components/ui'
import { Field } from './Field'
import styles from './Calendars.module.css'

/** Подписка на календарь по ссылке .ics: праздники, расписание команды, секретный адрес Google. */
export function IcsForm({ onDone }: { onDone: (message: string) => void }) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const create = useCreateIntegration()

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault()
        if (!url.trim()) return
        create.mutate(
          { kind: 'ics', url: url.trim(), name: name.trim() || undefined },
          { onSuccess: (it) => onDone(`Подписались на «${it.name}»`) },
        )
      }}
    >
      <p className={styles.lead}>
        События по ссылке появятся рядом с вашими и будут обновляться сами. Изменить их можно только в исходном
        календаре.
      </p>
      <Field
        id="ics-url"
        label="Ссылка на календарь"
        value={url}
        onValue={setUrl}
        placeholder="https://… или webcal://…"
        inputMode="url"
        plain
      />
      <Field
        id="ics-name"
        label="Название — необязательно"
        value={name}
        onValue={setName}
        placeholder="Например, «Праздники»"
        maxLength={60}
      />
      {create.error && (
        <p className={styles.error} role="alert">
          {apiErrorText(create.error)}
        </p>
      )}
      <Pill tone="dark" type="submit" className={styles.submit} disabled={!url.trim() || create.isPending}>
        {create.isPending ? 'Проверяю ссылку…' : 'Подписаться'}
      </Pill>
    </form>
  )
}
