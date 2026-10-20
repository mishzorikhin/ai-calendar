export type Badge = 'sleep' | 'routine' | 'work' | 'food' | 'sport' | 'read'

export type CalendarEvent = {
  id: string
  title: string
  subtitle?: string
  /** Минуты от полуночи. */
  start: number
  end: number
  badge: Badge
  highlight?: boolean
}

/** Событие, созданное пользователем вручную, привязано к дате. */
export type DatedEvent = CalendarEvent & { date: Date }

export type DayPartId = 'morning' | 'afternoon' | 'night'

export type DayPart = {
  id: DayPartId
  title: string
  from: number
  to: number
}

export type Slot = {
  start: number
  end: number
  before?: { title: string; at: number }
  after?: { title: string; at: number }
  /** События, с которыми пересекается выбранное время. */
  conflicts: string[]
}

/** Новое событие пользователя (до сохранения). */
export type NewEvent = Pick<CalendarEvent, 'title' | 'start' | 'end'> & {
  date: Date
  subtitle?: string
  badge?: Badge
}

/** Частичное обновление события. subtitle: '' очищает место/заметку. */
export type EventPatch = {
  title?: string
  subtitle?: string
  date?: Date
  start?: number
  end?: number
  badge?: Badge
}

/** Значки событий по числам месяца. */
export type MonthDots = Readonly<Record<number, readonly Badge[]>>

export type ChatMessage = { id: number; role: 'user' | 'ai'; text: string }

/** Тег задачи — свободный текст; PRESET_TAGS в PrepCard дают подсказки с иконками. */
export type TaskCategory = string
export type TaskKind = 'task' | 'goal'

/** Пользователь аккаунта: логин для @упоминаний, name — отображаемое имя. */
export type User = {
  id: number
  username: string
  name: string
}

/** Уведомление аккаунта («вам поделились задачей»), новые первыми. */
export type AppNotification = {
  id: number
  text: string
  taskId?: string
  from?: User
  read: boolean
  createdAt: string
}

/** Задача или цель из блока «Задачи и цели» на главном экране. */
export type Task = {
  id: string
  title: string
  subtitle?: string
  kind: TaskKind
  category?: TaskCategory
  done: boolean
  /** Дедлайн цели, YYYY-MM-DD. */
  due?: string
  /** Совместная работа: владелец и участники (только в server-режиме). */
  owner?: User
  members?: User[]
  /** Роль текущего пользователя: владелец удаляет задачу, участник — выходит из неё. */
  role?: 'owner' | 'member'
}

/** Новая задача (до сохранения). members — логины участников, с которыми поделиться. */
export type NewTask = {
  title: string
  subtitle?: string
  kind?: TaskKind
  category?: TaskCategory
  due?: string
  members?: string[]
}

/** Частичное обновление задачи. category: '' очищает категорию; members — добавить участников. */
export type TaskPatch = {
  title?: string
  subtitle?: string
  kind?: TaskKind
  category?: TaskCategory | ''
  done?: boolean
  due?: string
  members?: string[]
}
