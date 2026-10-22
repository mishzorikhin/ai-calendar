import { AnimatePresence, m } from 'framer-motion'
import { useState, type ReactNode } from 'react'
import { apiErrorText } from '../../../api/api'
import { useUpdateProfile } from '../../../api/queries'
import { BottomSheet } from '../../../components/BottomSheet'
import { Segmented } from '../../../components/Segmented'
import { Pill } from '../../../components/ui'
import type { Focus, Profile, ProtectedBlock } from '../../../domain/types'
import { spring } from '../../../lib/motion'
import { DayPicker, SwitchRow, TimePill } from './Fields'
import styles from './Assistant.module.css'

const BLOCKS: ProtectedBlock[] = [
  { title: 'Обед', start: 13 * 60, end: 14 * 60, days: [1, 2, 3, 4, 5] },
  { title: 'Спорт', start: 19 * 60, end: 20 * 60 + 30 },
  { title: 'Дорога на работу', start: 8 * 60 + 30, end: 9 * 60, days: [1, 2, 3, 4, 5] },
]

const STEPS = 5

/**
 * Анкета при первом входе: пять коротких шагов — ритм дня, работа, когда лучше думается,
 * что не занимать, как говорить. Можно пропустить; всё меняется потом в «Ассистент обо мне».
 */
export function OnboardingSheet({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const update = useUpdateProfile()
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [draft, setDraft] = useState(profile)
  const set = (patch: Partial<Profile>) => setDraft((d) => ({ ...d, ...patch }))
  const finish = (patch: Partial<Profile>) => update.mutate({ ...patch, onboarded: true }, { onSuccess: onClose })
  // Пропустить или смахнуть — закрываемся сразу, отметка «пройдено» уходит в фоне.
  const dismiss = () => {
    update.mutate({ onboarded: true })
    onClose()
  }
  const go = (delta: number) => {
    setDir(delta)
    setStep((s) => s + delta)
  }
  const hasBlock = (b: ProtectedBlock) => draft.protected.some((x) => x.title === b.title)
  const toggleBlock = (b: ProtectedBlock) =>
    set({ protected: hasBlock(b) ? draft.protected.filter((x) => x.title !== b.title) : [...draft.protected, b] })
  const noWork = draft.workDays.length === 0

  const steps: { title: string; text: string; body: ReactNode }[] = [
    {
      title: 'Познакомимся?',
      text: 'Пара вопросов — и ассистент будет планировать под ваш ритм, а не под чужой.',
      body: (
        <div className={styles.timeRow}>
          <span>Встаю</span>
          <TimePill label="Подъём" value={draft.wakeUp} onChange={(wakeUp) => set({ wakeUp })} />
          <span>ложусь</span>
          <TimePill label="Отбой" value={draft.bedTime} onChange={(v) => set({ bedTime: v === 0 ? 1440 : v })} />
        </div>
      ),
    },
    {
      title: 'Когда вы работаете?',
      text: 'Созвоны и рабочие задачи ассистент поставит только сюда.',
      body: (
        <>
          {!noWork && (
            <>
              <div className={styles.timeRow}>
                <span>С</span>
                <TimePill label="Начало работы" value={draft.workStart} onChange={(workStart) => set({ workStart })} />
                <span>до</span>
                <TimePill
                  label="Конец работы"
                  value={draft.workEnd}
                  onChange={(v) => set({ workEnd: v === 0 ? 1440 : v })}
                />
              </div>
              <DayPicker label="Рабочие дни" days={draft.workDays} onChange={(workDays) => set({ workDays })} />
            </>
          )}
          <SwitchRow
            label="Нет постоянного графика"
            on={noWork}
            onChange={(on) => set({ workDays: on ? [] : [1, 2, 3, 4, 5] })}
          />
        </>
      ),
    },
    {
      title: 'Когда лучше думается?',
      text: 'Туда — задачи, где нужна голова. Встречи — в другое время.',
      body: (
        <Segmented
          label="Когда лучше думается"
          options={[
            { id: 'morning', label: 'Утром' },
            { id: 'afternoon', label: 'Днём' },
            { id: 'evening', label: 'Вечером' },
            { id: 'none', label: 'Не важно' },
          ]}
          value={draft.focus}
          onChange={(focus: Focus) => set({ focus })}
        />
      ),
    },
    {
      title: 'Что не занимать?',
      text: 'Сюда ассистент ничего не поставит. Свои блоки добавите потом в настройках.',
      body: (
        <div className={styles.switches}>
          {BLOCKS.map((b) => (
            <SwitchRow
              key={b.title}
              label={b.title}
              hint={`${Math.floor(b.start / 60)}:${String(b.start % 60).padStart(2, '0')}–${Math.floor(b.end / 60)}:${String(b.end % 60).padStart(2, '0')}${b.days ? ', по будням' : ''}`}
              on={hasBlock(b)}
              onChange={() => toggleBlock(b)}
            />
          ))}
        </div>
      ),
    },
    {
      title: 'Как с вами говорить?',
      text: 'Тон можно поменять в любой момент.',
      body: (
        <div className={styles.stackGap}>
          <Segmented
            label="Обращение"
            options={[
              { id: 'ty', label: 'На «ты»' },
              { id: 'vy', label: 'На «вы»' },
            ]}
            value={draft.address}
            onChange={(address) => set({ address })}
          />
          <Segmented
            label="Подробность ответов"
            options={[
              { id: 'brief', label: 'Коротко' },
              { id: 'detailed', label: 'Подробно' },
            ]}
            value={draft.tone}
            onChange={(tone) => set({ tone })}
          />
        </div>
      ),
    },
  ]
  const current = steps[step]
  const last = step === STEPS - 1

  return (
    <BottomSheet label="Знакомство с ассистентом" onClose={dismiss}>
      <div className={styles.onboarding}>
        <div className={styles.progress} aria-label={`Шаг ${step + 1} из ${STEPS}`} role="img">
          {steps.map((_, i) => (
            <i key={i} className={i <= step ? styles.progressOn : undefined} />
          ))}
        </div>
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          {current && (
            <m.div
              key={step}
              custom={dir}
              initial={{ opacity: 0, x: dir * 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -40 }}
              transition={spring}
              className={styles.step}
            >
              <h2 className={`title ${styles.stepTitle}`}>{current.title}</h2>
              <p className={styles.lead}>{current.text}</p>
              <div className={styles.stepBody}>{current.body}</div>
            </m.div>
          )}
        </AnimatePresence>
        {update.error && (
          <p className={styles.error} role="alert">
            {apiErrorText(update.error)}
          </p>
        )}
        <div className={styles.stepActions}>
          {step === 0 ? (
            <Pill small tone="ghost" onClick={dismiss}>
              Пропустить
            </Pill>
          ) : (
            <Pill small tone="ghost" onClick={() => go(-1)}>
              Назад
            </Pill>
          )}
          <Pill
            tone="dark"
            disabled={update.isPending}
            onClick={() => {
              if (last) finish(draft)
              else go(1)
            }}
          >
            {last ? 'Готово' : 'Дальше'}
          </Pill>
        </div>
      </div>
    </BottomSheet>
  )
}
