import { useTasks, useUpdateTask } from '../api/queries'
import { CheckIcon } from './Icons'
import { Pressable } from './ui'
import styles from './EventComposer.module.css'

/**
 * Задача, под которую ассистент поставил это время: отметить её выполненной прямо из события.
 * Задачу удалили — строки нет.
 */
export function EventTask({ taskId }: { taskId: string }) {
  const { tasks } = useTasks()
  const update = useUpdateTask()
  const task = tasks.find((t) => t.id === taskId)
  if (!task) return null
  return (
    <Pressable
      className={`${styles.taskLink} ${task.done ? styles.taskDone : ''}`}
      role="checkbox"
      aria-checked={task.done}
      aria-label={`Задача «${task.title}» выполнена`}
      onClick={() => update.mutate({ id: task.id, patch: { done: !task.done } })}
    >
      <i className={styles.taskCheck} aria-hidden="true">
        {task.done && <CheckIcon size={13} strokeWidth={2.6} />}
      </i>
      <span className={styles.taskText}>
        <span className="caption">Задача</span>
        {task.title}
      </span>
    </Pressable>
  )
}
