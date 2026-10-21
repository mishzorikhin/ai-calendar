import { Avatar, Stack } from '../../components/ui'
import type { Task, User } from '../../domain/types'
import { userColor, userInitials } from './avatar'
import styles from './Home.module.css'

/**
 * Люди общей задачи на карточке: стопка аватарок участников; если задача
 * поделена со мной — аватарка владельца первой. Пусто у личных задач.
 */
export function TaskPeople({ task, size = 22 }: { task: Task; size?: number }) {
  const people: User[] = []
  if (task.role === 'member' && task.owner) people.push(task.owner)
  for (const m of task.members ?? []) people.push(m)
  if (people.length === 0) return null
  const shown = people.slice(0, 3)
  return (
    <span className={styles.people} title={people.map((u) => `@${u.username}`).join(', ')}>
      <Stack overlap={8}>
        {shown.map((u) => (
          <Avatar key={u.username} initials={userInitials(u)} color={userColor(u.username)} size={size} />
        ))}
      </Stack>
      {people.length > shown.length && <span className={styles.peopleMore}>+{people.length - shown.length}</span>}
    </span>
  )
}
