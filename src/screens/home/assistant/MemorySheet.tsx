import { useState } from 'react'
import { useMemories, usePeople, useProfile, useUpdateProfile } from '../../../api/queries'
import { BottomSheet } from '../../../components/BottomSheet'
import { CloseIcon } from '../../../components/Icons'
import { Segmented } from '../../../components/Segmented'
import { CircleButton } from '../../../components/ui'
import { DEFAULT_PROFILE } from '../../../domain/profile'
import { FactsTab } from './FactsTab'
import { SwitchRow } from './Fields'
import { PeopleTab } from './PeopleTab'
import styles from './Assistant.module.css'

type Tab = 'facts' | 'people'

/** Шторка «Что ассистент обо мне знает»: факты и догадки, карточки людей, выключатель памяти. */
export function MemorySheet({ onClose, initialTab = 'facts' }: { onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const { data } = useProfile()
  const update = useUpdateProfile()
  const profile = data ?? DEFAULT_PROFILE
  const { memories } = useMemories()
  const { people } = usePeople()

  return (
    <BottomSheet label="Что ассистент обо мне знает" onClose={onClose}>
      <div className={styles.head}>
        <h2>Что ассистент знает</h2>
        <CircleButton tone="gray" size={44} onClick={onClose} aria-label="Закрыть">
          <CloseIcon size={18} />
        </CircleButton>
      </div>
      <p className={styles.lead}>
        Ассистент запоминает то, что вы рассказываете о себе, и подставляет нужное в запросы к модели. Здесь видно всё,
        что он помнит, — поправьте или удалите лишнее.
      </p>

      <div className={styles.memorySwitch}>
        <SwitchRow
          label="Запоминать новое"
          hint={
            profile.memory
              ? 'Факты уходят модели вместе с вашими запросами'
              : 'Выключено: ничего не запоминает и не использует'
          }
          on={profile.memory}
          onChange={(memory) => update.mutate({ memory })}
        />
      </div>

      <div className={styles.tabs}>
        <Segmented
          label="Раздел"
          options={[
            { id: 'facts', label: memories.length ? `Факты · ${memories.length}` : 'Факты' },
            { id: 'people', label: people.length ? `Люди · ${people.length}` : 'Люди' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'facts' ? <FactsTab memories={memories} /> : <PeopleTab people={people} />}
    </BottomSheet>
  )
}
