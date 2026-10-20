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
