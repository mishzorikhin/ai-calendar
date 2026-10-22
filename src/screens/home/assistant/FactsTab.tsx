import { useState } from 'react'
import { apiErrorText } from '../../../api/api'
import { useCreateMemory, useDeleteAllMemories, useDeleteMemory, useUpdateMemory } from '../../../api/queries'
import { CheckIcon, CloseIcon, TrashIcon } from '../../../components/Icons'
import { Pill, Pressable } from '../../../components/ui'
import { MEMORY_KINDS, PROFILE_LIMITS, isMemoryDate, memoryDateLabel } from '../../../domain/profile'
import type { Memory, MemoryKind } from '../../../domain/types'
import { PillChoice } from './Fields'
import styles from './Assistant.module.css'

const KIND_OPTIONS = MEMORY_KINDS.filter((k) => k.id !== 'person').map((k) => ({ id: k.id, label: k.label }))

/** Факты памяти: догадки ждут ответа, остальное — по видам, с правкой и удалением. */
export function FactsTab({ memories }: { memories: Memory[] }) {
  const guesses = memories.filter((m) => m.source === 'inferred' && !m.confirmed)
  const facts = memories.filter((m) => !(m.source === 'inferred' && !m.confirmed))
  const groups = MEMORY_KINDS.map((k) => ({ ...k, items: facts.filter((m) => m.kind === k.id) })).filter(
    (g) => g.items.length > 0,
  )
  const update = useUpdateMemory()
  const removeAll = useDeleteAllMemories()
  const [sure, setSure] = useState(false)

  return (
    <>
      {guesses.length > 0 && (
        <section className={styles.guesses} aria-label="Догадки">
          <p className={styles.sectionLabel}>Ассистент заметил — верно?</p>
          <ul className={styles.list}>
            {guesses.map((m) => (
              <li key={m.id} className={`${styles.row} ${styles.guess}`}>
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>{m.text}</span>
                </span>
                <Pressable
                  className={styles.rowAction}
                  aria-label={`Неверно: ${m.text}`}
                  onClick={() => update.mutate({ id: m.id, patch: { rejected: true } })}
                >
                  <CloseIcon size={18} />
                </Pressable>
                <Pressable
                  className={`${styles.rowAction} ${styles.rowYes}`}
                  aria-label={`Верно: ${m.text}`}
                  onClick={() => update.mutate({ id: m.id, patch: { confirmed: true } })}
                >
                  <CheckIcon size={18} />
                </Pressable>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AddFact />

      {groups.length === 0 ? (
        <p className={styles.empty}>
          Пока пусто. Расскажите ассистенту о себе — «по пятницам я не работаю», «у мамы день рождения 14 марта» — и он
          запомнит.
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.id} aria-label={g.plural}>
            <p className={styles.sectionLabel}>{g.plural}</p>
            <ul className={styles.list}>
              {g.items.map((m) => (
                <FactRow key={`${m.id}-${m.updatedAt}`} memory={m} />
              ))}
            </ul>
          </section>
        ))
      )}

      {facts.length > 0 && (
        <div className={styles.footer}>
          <Pressable
            className={`${styles.danger} ${sure ? styles.dangerSure : ''}`}
            disabled={removeAll.isPending}
            onClick={() => (sure ? removeAll.mutate(undefined, { onSettled: () => setSure(false) }) : setSure(true))}
          >
            {sure ? 'Точно забыть всё?' : 'Забыть всё'}
          </Pressable>
        </div>
      )}
      {(update.error || removeAll.error) && (
        <p className={styles.error} role="alert">
          {apiErrorText(update.error ?? removeAll.error)}
        </p>
      )}
    </>
  )
}

/** Факт: текст правится по нажатию, удаление — корзиной. */
function FactRow({ memory }: { memory: Memory }) {
  const update = useUpdateMemory()
  const remove = useDeleteMemory()
  const [draft, setDraft] = useState<string | null>(null)
  const save = () => {
    const text = draft?.trim()
    if (text && text !== memory.text) update.mutate({ id: memory.id, patch: { text } })
    setDraft(null)
  }
  return (
    <li className={styles.row}>
      {draft === null ? (
        <button type="button" className={styles.rowText} onClick={() => setDraft(memory.text)}>
          <span className={styles.rowTitle}>{memory.text}</span>
          {(memory.date || memory.source === 'inferred') && (
            <span className={styles.rowSub}>
              {[memory.date && memoryDateLabel(memory.date), memory.source === 'inferred' && 'догадка, подтверждена']
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
        </button>
      ) : (
        <input
          className={`${styles.input} ${styles.rowInput}`}
          value={draft}
          maxLength={PROFILE_LIMITS.memoryText}
          aria-label="Текст факта"
          ref={(el) => el?.focus()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') {
              e.stopPropagation()
              setDraft(null)
            }
          }}
        />
      )}
      <Pressable
        className={styles.rowAction}
        aria-label={`Забыть: ${memory.text}`}
        onClick={() => remove.mutate(memory.id)}
      >
        <TrashIcon size={18} />
      </Pressable>
    </li>
  )
}

/** Добавить факт вручную: вид, текст, дата (для дат). */
function AddFact() {
  const create = useCreateMemory()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<MemoryKind>('rule')
  const [text, setText] = useState('')
  const [date, setDate] = useState('')
  // Дата из поля «ДД.ММ» или «ДД.ММ.ГГГГ» — в формат памяти.
  const isoDate = (() => {
    const m = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/.exec(date.trim())
    if (!m) return date.trim()
    const dd = m[1]?.padStart(2, '0')
    const mm = m[2]?.padStart(2, '0')
    return m[3] ? `${m[3]}-${mm}-${dd}` : `--${mm}-${dd}`
  })()
  const dateOk = kind !== 'date' || (isoDate !== '' && isMemoryDate(isoDate))
  if (!open) {
    return (
      <Pill small tone="ghost" className={styles.addBtn} onClick={() => setOpen(true)}>
        + Добавить факт
      </Pill>
    )
  }
  const submit = () => {
    if (!text.trim() || !dateOk) return
    create.mutate(
      { kind, text, date: kind === 'date' ? isoDate : undefined },
      {
        onSuccess: () => {
          setText('')
          setDate('')
          setOpen(false)
        },
      },
    )
  }
  return (
    <div className={`${styles.form} ${styles.formCard}`}>
      <PillChoice label="Вид факта" options={KIND_OPTIONS} value={kind} onChange={setKind} />
      <input
        className={styles.input}
        value={text}
        maxLength={PROFILE_LIMITS.memoryText}
        placeholder={kind === 'date' ? 'День рождения мамы' : 'Не ставить встречи до 11'}
        aria-label="Факт"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      {kind === 'date' && (
        <input
          className={styles.input}
          value={date}
          inputMode="numeric"
          placeholder="14.03 или 14.03.1990"
          aria-label="Дата"
          aria-invalid={date !== '' && !dateOk}
          onChange={(e) => setDate(e.target.value)}
        />
      )}
      <div className={styles.formActions}>
        <Pill small tone="ghost" onClick={() => setOpen(false)}>
          Отмена
        </Pill>
        <Pill small tone="dark" disabled={!text.trim() || !dateOk || create.isPending} onClick={submit}>
          Запомнить
        </Pill>
      </div>
      {create.error && (
        <p className={styles.error} role="alert">
          {apiErrorText(create.error)}
        </p>
      )}
    </div>
  )
}
