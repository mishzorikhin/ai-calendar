import { AnimatePresence, m } from 'framer-motion'
import { useState } from 'react'
import { useTasks, useUpdateTask } from '../../api/queries'
import { BottomSheet } from '../../components/BottomSheet'
import { CheckIcon, ChevronDownIcon, CloseIcon } from '../../components/Icons'
import { CircleButton, Pill, Pressable } from '../../components/ui'
import { spring } from '../../lib/motion'
import type { Task } from '../../domain/types'
import { TAG_PRESETS, tagIconEl, tagLabel } from './tags'
import { TaskPeople } from './TaskPeople'
import styles from './Home.module.css'

/** Обычные задачи: по одной карточке на задачу, справа — тег. Выполненные сворачиваются. */
export function PrepCard({ onEdit }: { onEdit: (task: Task) => void }) {
  const { tasks } = useTasks()
  const [showDone, setShowDone] = useState(false)
  const items = tasks.filter((t) => t.kind === 'task')
  const open = items.filter((t) => !t.done)
  const done = items.filter((t) => t.done)
  if (items.length === 0) return null
  return (
    <>
      {open.map((task) => (
        <TaskCard key={task.id} task={task} onEdit={onEdit} />
      ))}
      {done.length > 0 && (
        <>
          <Pressable
            className={styles.doneToggle}
            onClick={() => setShowDone((s) => !s)}
            aria-expanded={showDone}
            scale={0.97}
          >
            Выполненные · {done.length}
            <m.span animate={{ rotate: showDone ? 180 : 0 }} transition={spring} className={styles.flex}>
              <ChevronDownIcon size={14} strokeWidth={2.2} />
            </m.span>
          </Pressable>
          <AnimatePresence initial={false}>
            {showDone && (
              <m.div
                key="done"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={spring}
                className={styles.doneWrap}
              >
                {done.map((task) => (
                  <TaskCard key={task.id} task={task} onEdit={onEdit} />
                ))}
              </m.div>
            )}
          </AnimatePresence>
        </>
      )}
    </>
  )
}

function TaskCard({ task, onEdit }: { task: Task; onEdit: (task: Task) => void }) {
  const update = useUpdateTask()
  const [tagOpen, setTagOpen] = useState(false)
  return (
    <div className={`${styles.prep} ${task.done ? styles.prepDone : ''}`}>
      <Pressable
        className={styles.prepCheck}
        onClick={() => update.mutate({ id: task.id, patch: { done: !task.done } })}
        aria-label={task.done ? 'Снять отметку' : 'Отметить выполненной'}
        aria-pressed={task.done}
      >
        <AnimatePresence initial={false}>
          {task.done && (
            <m.span
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={spring}
            >
              <CheckIcon size={14} strokeWidth={2.4} />
            </m.span>
          )}
        </AnimatePresence>
      </Pressable>
      <Pressable
        className={styles.cardTextBtn}
        scale={0.98}
        onClick={() => onEdit(task)}
        aria-label={`Изменить: ${task.title}`}
      >
        <span className={styles.cardTitle}>{task.title}</span>
        {task.subtitle && <span className="caption">{task.subtitle}</span>}
        <TaskPeople task={task} />
      </Pressable>
      <Pressable
        className={`${styles.tagChip} ${task.category ? styles.tagChipSet : ''}`}
        onClick={() => setTagOpen(true)}
        aria-label={task.category ? `Тег: ${tagLabel(task.category)}` : 'Поставить тег'}
        title={task.category ? tagLabel(task.category) : 'Поставить тег'}
        scale={0.93}
      >
        {task.category ? (
          <>
            {tagIconEl(task.category)}
            <span className={styles.tagLabel}>{tagLabel(task.category)}</span>
          </>
        ) : (
          'Тег'
        )}
      </Pressable>
      {tagOpen && <TagSheet task={task} onClose={() => setTagOpen(false)} />}
    </div>
  )
}

/** Шторка выбора тега: готовые с иконками или любой свой текст. */
function TagSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const update = useUpdateTask()
  const [custom, setCustom] = useState(task.category && !tagPreset(task.category) ? task.category : '')

  const set = (category: string) => {
    update.mutate({ id: task.id, patch: { category } }, { onSuccess: onClose })
  }
  const saveCustom = () => {
    const tag = custom.trim().toLowerCase()
    if (tag) set(tag)
  }

  return (
    <BottomSheet label="Тег задачи" onClose={onClose}>
      <div className={styles.tagSheet}>
        <div className={styles.tagSheetHead}>
          <h2>Тег задачи</h2>
          <CircleButton tone="gray" size={44} onClick={onClose} aria-label="Закрыть">
            <CloseIcon size={18} />
          </CircleButton>
        </div>
        <div className={styles.tagRow}>
          {TAG_PRESETS.map(({ id, icon: Icon, label }) => (
            <Pill
              key={id}
              tone={task.category === id ? 'dark' : 'ghost'}
              aria-pressed={task.category === id}
              onClick={() => set(id)}
              className={styles.tagPill}
            >
              <Icon size={15} /> {label}
            </Pill>
          ))}
        </div>
        <input
          className={styles.tagInput}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveCustom()}
          placeholder="Или свой тег…"
          aria-label="Свой тег"
          maxLength={24}
          enterKeyHint="done"
        />
        <div className={styles.tagActions}>
          {task.category && (
            <Pill tone="ghost" onClick={() => set('')}>
              Убрать тег
            </Pill>
          )}
          {custom.trim() && (
            <Pill tone="dark" onClick={saveCustom} disabled={update.isPending}>
              Сохранить
            </Pill>
          )}
        </div>
      </div>
    </BottomSheet>
  )
}

function tagPreset(category: string): boolean {
  return TAG_PRESETS.some((p) => p.id === category)
}
