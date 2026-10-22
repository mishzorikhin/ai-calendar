import { useState } from 'react'
import { apiErrorText } from '../../../api/api'
import { useProfile, useUpdateProfile } from '../../../api/queries'
import { BottomSheet } from '../../../components/BottomSheet'
import { CloseIcon } from '../../../components/Icons'
import { Segmented } from '../../../components/Segmented'
import { CircleButton } from '../../../components/ui'
import { DEFAULT_PROFILE, PROFILE_LIMITS } from '../../../domain/profile'
import type { Focus, Profile } from '../../../domain/types'
import { useApi } from '../../../api/provider'
import { BlocksEditor } from './BlocksEditor'
import { NameGroup } from './NameGroup'
import { DayPicker, Group, PillChoice, TimePill } from './Fields'
import { SuggestionsGroup } from './SuggestionsGroup'
import styles from './Assistant.module.css'

const FOCUS = [
  { id: 'none', label: 'Не важно' },
  { id: 'morning', label: 'Утром' },
  { id: 'afternoon', label: 'Днём' },
  { id: 'evening', label: 'Вечером' },
] as const satisfies readonly { id: Focus; label: string }[]

const MEETING = [30, 45, 60, 90, 120].map((m) => ({
  id: m,
  label: m < 60 ? `${m} мин` : `${m / 60} ч`.replace('.5', ',5'),
}))
const BUFFER = [0, 5, 10, 15, 30].map((m) => ({ id: m, label: m === 0 ? 'Без перерыва' : `${m} мин` }))

/** Отбой «00:00» из выбора времени — это полночь в конце дня. */
const bedTime = (m: number) => (m === 0 ? 1440 : m)

/** Шторка «Ассистент обо мне»: ритм дня, работа, «святые» блоки, манера общения, предложения. */
export function ProfileSheet({ onClose }: { onClose: () => void }) {
  const { data, isError } = useProfile()
  const update = useUpdateProfile()
  const p = data ?? DEFAULT_PROFILE
  const set = (patch: Partial<Profile>) => update.mutate(patch)
  const server = useApi().mode === 'server'

  return (
    <BottomSheet label="Ассистент обо мне" onClose={onClose}>
      <div className={styles.head}>
        <h2>Ассистент обо мне</h2>
        <CircleButton tone="gray" size={44} onClick={onClose} aria-label="Закрыть">
          <CloseIcon size={18} />
        </CircleButton>
      </div>
      <p className={styles.lead}>
        С этим ассистент ищет время и подбирает слова. Менять можно и голосом: «теперь работаю с десяти».
      </p>

      {server && <NameGroup />}

      <Group title="Ритм дня" hint="Окна для дел ищутся между подъёмом и отбоем">
        <div className={styles.timeRow}>
          <span>Встаю</span>
          <TimePill label="Подъём" value={p.wakeUp} onChange={(wakeUp) => set({ wakeUp })} />
          <span>ложусь</span>
          <TimePill label="Отбой" value={p.bedTime} onChange={(m) => set({ bedTime: bedTime(m) })} />
        </div>
      </Group>

      <Group title="Работа" hint="Созвоны и рабочие задачи — только в эти часы и дни">
        <div className={styles.timeRow}>
          <span>С</span>
          <TimePill label="Начало работы" value={p.workStart} onChange={(workStart) => set({ workStart })} />
          <span>до</span>
          <TimePill label="Конец работы" value={p.workEnd} onChange={(m) => set({ workEnd: bedTime(m) })} />
        </div>
        <DayPicker label="Рабочие дни" days={p.workDays} onChange={(workDays) => set({ workDays })} />
      </Group>

      <Group title="Лучше думается" hint="Сюда ассистент поставит задачи, где нужна голова, а встречи — в другое время">
        <Segmented label="Когда лучше думается" options={FOCUS} value={p.focus} onChange={(focus) => set({ focus })} />
      </Group>

      <Group title="Встречи">
        <p className={styles.subTitle}>Обычно длятся</p>
        <PillChoice
          label="Обычная длина встречи"
          options={MEETING}
          value={p.meetingMinutes}
          onChange={(meetingMinutes) => set({ meetingMinutes })}
        />
        <p className={styles.subTitle}>Между делами</p>
        <PillChoice
          label="Перерыв между делами"
          options={BUFFER}
          value={p.bufferMinutes}
          onChange={(bufferMinutes) => set({ bufferMinutes })}
        />
      </Group>

      <BlocksEditor blocks={p.protected} onChange={(blocks) => set({ protected: blocks })} />

      <Group title="Как говорить">
        <div className={styles.stackGap}>
          <Segmented
            label="Обращение"
            options={[
              { id: 'ty', label: 'На «ты»' },
              { id: 'vy', label: 'На «вы»' },
            ]}
            value={p.address}
            onChange={(address) => set({ address })}
          />
          <Segmented
            label="Подробность ответов"
            options={[
              { id: 'brief', label: 'Коротко' },
              { id: 'detailed', label: 'Подробно' },
            ]}
            value={p.tone}
            onChange={(tone) => set({ tone })}
          />
        </div>
      </Group>

      <AboutGroup key={p.about ?? ''} about={p.about ?? ''} onSave={(about) => set({ about })} />

      <SuggestionsGroup profile={p} onChange={set} />

      {(update.error || isError) && (
        <p className={styles.error} role="alert">
          {update.error ? apiErrorText(update.error) : 'Профиль не загрузился — проверьте соединение'}
        </p>
      )}
    </BottomSheet>
  )
}

/** «О себе»: свободный текст, сохраняется, когда поле теряет фокус. Ключ по сохранённому тексту сбрасывает черновик. */
function AboutGroup({ about, onSave }: { about: string; onSave: (about: string) => void }) {
  const [draft, setDraft] = useState(about)
  return (
    <Group title="О себе" hint="Всё, что ещё важно знать: «есть собака — гуляю в 8 и 20», «не люблю звонки»">
      <textarea
        className={styles.textarea}
        value={draft}
        maxLength={PROFILE_LIMITS.about}
        rows={3}
        aria-label="О себе"
        placeholder="Например: по вторникам забираю сына из школы в 17:00"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() !== about && onSave(draft)}
      />
    </Group>
  )
}
