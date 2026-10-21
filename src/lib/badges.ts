import type { Badge } from '../domain/types'

/** Цвет значка события — из токенов дизайн-системы. */
export const BADGE_COLOR: Record<Badge, string> = {
  sleep: 'var(--green)',
  routine: 'var(--blue)',
  work: 'var(--blue)',
  food: 'var(--orange)',
  sport: 'var(--green)',
  read: 'var(--purple)',
}

/** Типы событий для выбора в интерфейсе — в порядке показа. */
export const BADGE_OPTIONS = [
  { id: 'routine', label: 'Дело' },
  { id: 'work', label: 'Работа' },
  { id: 'food', label: 'Еда' },
  { id: 'sport', label: 'Спорт' },
  { id: 'read', label: 'Чтение' },
  { id: 'sleep', label: 'Сон' },
] as const satisfies readonly { id: Badge; label: string }[]
