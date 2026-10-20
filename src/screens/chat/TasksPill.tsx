import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { useTasks, useUpdateTask } from '../../api/queries'
import { CheckIcon, ChevronDownIcon } from '../../components/Icons'
import { Pressable } from '../../components/ui'
import { MONTHS_GENITIVE, fromISODate } from '../../lib/dates'
import { spring } from '../../lib/motion'
import { plural } from '../../lib/plural'
import type { Task } from '../../domain/types'
import styles from './Chat.module.css'

function taskSub(t: Task): string {
  if (t.subtitle) return t.subtitle
  if (t.kind === 'goal' && t.due) {
    const d = fromISODate(t.due)
    return `Цель · к ${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}`
  }
  return t.kind === 'goal' ? 'Цель' : 'Задача'
}

/** «Живая активность» сверху: число открытых задач, по нажатию — их список. */
export function TasksPill() {
  const { tasks, isError, refetch } = useTasks()
  const update = useUpdateTask()
  const [open, setOpen] = useState(false)
  const active = tasks.filter((t) => !t.done)

  return (
    <>
      <motion.button
        type="button"
        className={styles.live}
        initial={{ scaleX: 0.6, opacity: 0 }}
        animate={{ scaleX: 1, opacity: 1 }}
        transition={{ ...spring, delay: 0.15 }}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="assistant-tasks"
      >
        <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>
          {isError ? (
            'Задачи недоступны'
          ) : (
            <>
              <b className="tnum">{active.length}</b> {plural(active.length, ['задача', 'задачи', 'задач'])}
            </>
          )}
        </motion.span>
        <motion.span className={styles.liveChevron} animate={{ rotate: open ? 180 : 0 }} transition={spring}>
          <ChevronDownIcon size={14} strokeWidth={2.4} />
        </motion.span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="scrim"
              className={styles.tasksScrim}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <motion.ul
              key="tasks"
              id="assistant-tasks"
              className={styles.tasks}
              initial={{ opacity: 0, scale: 0.85, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -16 }}
              transition={spring}
              onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            >
              {isError && (
                <li className={styles.taskEmpty}>
                  Не удалось загрузить задачи.
                  <button type="button" className={styles.taskRetry} onClick={() => void refetch()}>
                    Повторить
                  </button>
                </li>
              )}
              {!isError && tasks.length === 0 && (
                <li className={styles.taskEmpty}>Задач пока нет — попросите ассистента добавить</li>
              )}
              {tasks.map((t) => (
                <li key={t.id}>
                  <Pressable
                    className={styles.task}
                    scale={0.98}
                    onClick={() => update.mutate({ id: t.id, patch: { done: !t.done } })}
                    aria-pressed={t.done}
                  >
                    <span className={`${styles.taskIcon} ${t.done ? styles.taskDone : ''}`} aria-hidden="true">
                      {t.done ? <CheckIcon size={14} strokeWidth={2.6} /> : <i />}
                    </span>
                    <span className={styles.taskText}>
                      <b>{t.title}</b>
                      <small>{taskSub(t)}</small>
                    </span>
                  </Pressable>
                </li>
              ))}
            </motion.ul>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
