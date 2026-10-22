import { SUGGESTION_KINDS } from '../../../domain/profile'
import type { Profile } from '../../../domain/types'
import { Group, PillChoice, SwitchRow } from './Fields'
import styles from './Assistant.module.css'

const PER_DAY = [
  { id: 0, label: 'Не присылать' },
  { id: 1, label: '1 в день' },
  { id: 2, label: '2 в день' },
  { id: 3, label: '3 в день' },
]

/** Предложения ассистента: сколько в день и какие виды. */
export function SuggestionsGroup({
  profile,
  onChange,
}: {
  profile: Profile
  onChange: (patch: Partial<Profile>) => void
}) {
  const muted = profile.muted ?? []
  return (
    <Group title="Ассистент предлагает сам" hint="Например: «Две задачи висят неделю — поставить одну на завтра в 10?»">
      <PillChoice
        label="Сколько предложений в день"
        options={PER_DAY}
        value={profile.proactive}
        onChange={(proactive) => onChange({ proactive })}
      />
      {profile.proactive > 0 && (
        <div className={styles.switches}>
          {SUGGESTION_KINDS.map((k) => (
            <SwitchRow
              key={k.id}
              label={k.label}
              on={!muted.includes(k.id)}
              onChange={(on) => onChange({ muted: on ? muted.filter((x) => x !== k.id) : [...muted, k.id] })}
            />
          ))}
        </div>
      )}
    </Group>
  )
}
