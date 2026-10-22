import { useState } from 'react'
import { PlusIcon, TrashIcon } from '../../../components/Icons'
import { Pill, Pressable } from '../../../components/ui'
import { PROFILE_LIMITS, daysLabel } from '../../../domain/profile'
import type { ProtectedBlock } from '../../../domain/types'
import { formatMinutes } from '../../../lib/dates'
import { DayPicker, Group, TimePill } from './Fields'
import styles from './Assistant.module.css'

/** Готовые блоки — в один тап. */
const PRESETS: ProtectedBlock[] = [
  { title: 'Обед', start: 13 * 60, end: 14 * 60, days: [1, 2, 3, 4, 5] },
  { title: 'Спорт', start: 19 * 60, end: 20 * 60 + 30 },
  { title: 'Дорога', start: 8 * 60 + 30, end: 9 * 60, days: [1, 2, 3, 4, 5] },
]

const EMPTY: ProtectedBlock = { title: '', start: 12 * 60, end: 13 * 60, days: [] }

/** «Не занимать»: отрезки дня, которые ассистент обходит при планировании. */
export function BlocksEditor({
  blocks,
  onChange,
}: {
  blocks: ProtectedBlock[]
  onChange: (blocks: ProtectedBlock[]) => void
}) {
  const [draft, setDraft] = useState<ProtectedBlock | null>(null)
  const full = blocks.length >= PROFILE_LIMITS.protectedBlocks
  const presets = PRESETS.filter((p) => !blocks.some((b) => b.title === p.title))
  const valid = draft !== null && draft.title.trim() !== '' && draft.end > draft.start

  return (
    <Group title="Не занимать" hint="Обед, спорт, дорога — ассистент не поставит сюда ничего">
      {blocks.length > 0 && (
        <ul className={styles.list}>
          {blocks.map((b, i) => (
            <li key={`${b.title}-${b.start}`} className={styles.row}>
              <span className={styles.rowText}>
                <span className={styles.rowTitle}>{b.title}</span>
                <span className={styles.rowSub}>
                  <span className="tnum">
                    {formatMinutes(b.start)}–{formatMinutes(b.end)}
                  </span>{' '}
                  · {daysLabel(b.days)}
                </span>
              </span>
              <Pressable
                className={styles.rowAction}
                aria-label={`Удалить «${b.title}»`}
                onClick={() => onChange(blocks.filter((_, j) => j !== i))}
              >
                <TrashIcon size={18} />
              </Pressable>
            </li>
          ))}
        </ul>
      )}

      {draft ? (
        <div className={styles.form}>
          <input
            className={styles.input}
            value={draft.title}
            maxLength={PROFILE_LIMITS.blockTitle}
            placeholder="Например, «Прогулка с собакой»"
            aria-label="Название"
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <div className={styles.timeRow}>
            <span>С</span>
            <TimePill label="Начало" value={draft.start} onChange={(start) => setDraft({ ...draft, start })} />
            <span>до</span>
            <TimePill
              label="Конец"
              value={draft.end}
              onChange={(end) => setDraft({ ...draft, end: end === 0 ? 1440 : end })}
            />
          </div>
          <DayPicker label="Дни" days={draft.days ?? []} onChange={(days) => setDraft({ ...draft, days })} />
          <p className={styles.groupHint}>Ни один день не выбран — каждый день</p>
          <div className={styles.formActions}>
            <Pill small tone="ghost" onClick={() => setDraft(null)}>
              Отмена
            </Pill>
            <Pill
              small
              tone="dark"
              disabled={!valid}
              onClick={() => {
                if (!valid) return
                onChange([...blocks, { ...draft, title: draft.title.trim() }])
                setDraft(null)
              }}
            >
              Добавить
            </Pill>
          </div>
        </div>
      ) : (
        !full && (
          <div className={styles.choices}>
            {presets.map((p) => (
              <Pill key={p.title} small tone="white" className={styles.choice} onClick={() => onChange([...blocks, p])}>
                + {p.title}
              </Pill>
            ))}
            <Pill small tone="white" className={styles.choice} onClick={() => setDraft(EMPTY)}>
              <PlusIcon size={14} strokeWidth={2.4} /> Свой
            </Pill>
          </div>
        )
      )}
    </Group>
  )
}
