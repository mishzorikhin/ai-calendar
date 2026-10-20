import { motion, useReducedMotion } from 'framer-motion'
import { useTasks, useUpdateTask } from '../../api/queries'
import { CheckIcon } from '../../components/Icons'
import { Pressable } from '../../components/ui'
import { MONTHS_GENITIVE, fromISODate } from '../../lib/dates'
import { bouncy, itemVariants, spring } from '../../lib/motion'
import type { Task } from '../../domain/types'
import { TaskPeople } from './TaskPeople'
import styles from './Home.module.css'

/** Цели: большие карточки с отметкой выполнения; тап по тексту — правка. */
export function TasksGrid({ onEdit }: { onEdit: (task: Task) => void }) {
  const { tasks } = useTasks()
  const goals = tasks.filter((t) => t.kind === 'goal')
  if (goals.length === 0) return null
  return (
    <div className={styles.grid}>
      {goals.map((goal) => (
        <motion.div layout transition={spring} variants={itemVariants} key={goal.id}>
          <GoalCard task={goal} onEdit={onEdit} />
        </motion.div>
      ))}
    </div>
  )
}

function goalCaption(task: Task): string {
  const parts = [task.subtitle || 'Цель']
  if (task.due) {
    const d = fromISODate(task.due)
    parts.push(`к ${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}`)
  }
  return parts.join(' · ')
}

function GoalCard({ task, onEdit }: { task: Task; onEdit: (task: Task) => void }) {
  const update = useUpdateTask()
  const still = useReducedMotion()
  const done = task.done
  return (
    <div className={`${styles.trip} ${done ? styles.tripDone : ''}`}>
      <motion.i
        className={styles.blobA}
        animate={still ? undefined : { y: [0, -6, 0], rotate: [0, 4, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.i
        className={styles.blobB}
        animate={still ? undefined : { y: [0, 5, 0], x: [0, -4, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <Pressable
        className={styles.cardTextBtn}
        scale={0.98}
        onClick={() => onEdit(task)}
        aria-label={`Изменить: ${task.title}`}
      >
        <span className={styles.cardTitle}>{task.title}</span>
        <span className="caption">{goalCaption(task)}</span>
        <TaskPeople task={task} size={20} />
      </Pressable>
      <Pressable
        className={`${styles.check} ${done ? styles.checkOn : ''}`}
        onClick={() => update.mutate({ id: task.id, patch: { done: !done } })}
        aria-label={done ? 'Снять отметку' : 'Отметить выполненной'}
        aria-pressed={done}
      >
        <motion.span animate={{ scale: done ? [0.6, 1.2, 1] : 1 }} transition={bouncy}>
          <CheckIcon size={18} strokeWidth={2.2} />
        </motion.span>
      </Pressable>
    </div>
  )
}
