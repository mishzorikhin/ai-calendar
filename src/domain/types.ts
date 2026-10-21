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
  /** Id подключённого календаря, откуда пришло событие (Google, Яндекс…); нет — своё. */
  source?: string
  /** Изменить можно только в исходном календаре: подписка, повтор серии, многодневное. */
  readOnly?: boolean
  /** На весь день: start 0, end 1440, время не занимает. */
  allDay?: boolean
  /**
   * За сколько минут до начала напомнить (раньше — первее). null или нет поля — как в
   * настройках уведомлений, [] — не напоминать.
   */
  reminders?: number[] | null
  /**
   * Повтор своего события. Вхождения приходят с тем же id и своей датой; правка по id меняет
   * всю серию, «только этот день» — `EventPatch.skip`.
   */
  repeat?: Repeat
  /** Последний день серии, ГГГГ-ММ-ДД; нет — бессрочно. */
  repeatUntil?: string
  /** Дни, убранные из серии (ГГГГ-ММ-ДД). */
  exdates?: string[]
}

export type Repeat = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'

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
  /** Нет поля — напоминание по умолчанию из настроек, [] — не напоминать. */
  reminders?: number[]
  repeat?: Repeat
  repeatUntil?: string
  /** На весь день: start 0, end 1440, время не занимает. */
  allDay?: boolean
}

/** Частичное обновление события. subtitle: '' очищает место/заметку. */
export type EventPatch = {
  title?: string
  subtitle?: string
  date?: Date
  start?: number
  end?: number
  badge?: Badge
  /** null — вернуть напоминание по умолчанию, [] — не напоминать. */
  reminders?: number[] | null
  /** '' — убрать повтор; repeatUntil: '' — бессрочно. */
  repeat?: Repeat | ''
  repeatUntil?: string
  /** Какое вхождение серии правят: перенос его на `date` сдвигает всю серию. */
  occurrence?: Date
  /** Убрать из серии один день. */
  skip?: Date
  /** true — на весь день; false — снова со временем (вместе с start и end). */
  allDay?: boolean
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
  /** IANA-пояс (Europe/Moscow): в нём сервер переводит время внешних календарей. */
  timeZone?: string
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

/** Вид подключённого календаря. */
export type IntegrationKind = 'ics' | 'caldav' | 'google' | 'outlook'

/** Подключённый внешний календарь. */
export type Integration = {
  id: string
  kind: IntegrationKind
  name: string
  /** Логин, e-mail или хост — подпись в списке. */
  account?: string
  badge: Badge
  /** В календарь можно записывать. */
  writable: boolean
  /** Сюда уходят новые события. */
  primary: boolean
  /** ISO-время последней удачной синхронизации. */
  lastSync?: string
  lastError?: string
}

/** Список подключений и какие OAuth-сервисы включены на сервере. */
export type IntegrationsInfo = {
  items: Integration[]
  providers: { google: boolean; outlook: boolean }
}

/** Календарь, найденный на CalDAV-сервере. */
export type CalDavCalendar = { url: string; name: string; color?: string; writable: boolean }

export type CalDavCredentials = { url: string; username: string; password: string }

/** Новое подключение: подписка по ссылке или CalDAV-календарь. */
export type NewIntegration =
  | { kind: 'ics'; url: string; name?: string; badge?: Badge }
  | ({ kind: 'caldav'; name?: string; badge?: Badge; writable: boolean; primary?: boolean } & CalDavCredentials)

export type IntegrationPatch = { name?: string; badge?: Badge; primary?: boolean }

/**
 * Настройки напоминаний аккаунта. Время — минуты от полуночи в поясе пользователя;
 * -1 — выключено.
 */
export type NotifySettings = {
  /** За сколько минут напоминать о событиях без своих напоминаний (и о внешних календарях). */
  eventReminder: number
  /** Во сколько напомнить о задаче или цели в день срока. */
  taskTime: number
  /** Во сколько присылать сводку дня. */
  digest: number
  /** Во сколько присылать план на завтра. */
  evening: number
  /** Тихие часы: в это время приходят только явно заданные напоминания. Оба −1 — выключены. */
  quietFrom: number
  quietTo: number
  /** Своё «по умолчанию» для типа события (минуты, −1 — не напоминать). */
  badgeReminders?: Partial<Record<Badge, number>>
}

/** Уведомления аккаунта: ключ для подписки браузера, настройки и число подписанных устройств. */
export type PushInfo = {
  /** applicationServerKey (base64url); null — уведомления недоступны (локальный режим). */
  publicKey: string | null
  settings: NotifySettings
  devices: number
}

/** Подписка браузера на Web Push — PushSubscription.toJSON(). */
export type PushSubscriptionData = {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
}

/** Своё напоминание без события («позвонить маме в 18:00») или отложенное из уведомления. */
export type Alarm = {
  id: number
  /** ISO-время, когда придёт. */
  at: string
  text: string
  kind: 'reminder' | 'event' | 'task' | 'digest' | 'share' | 'test'
}

/** Устройство, на котором включены уведомления. id — начало sha256 адреса подписки. */
export type PushDevice = {
  id: string
  label: string
  createdAt: string
}
