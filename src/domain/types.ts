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
  /** У вхождения серии — её первый день (ГГГГ-ММ-ДД). */
  seriesDate?: string
  /** Заметки и ссылка (созвон, билет). Место — subtitle. */
  notes?: string
  url?: string
  /** Сколько минут добираться: время до начала занято, придёт «пора выезжать». */
  travel?: number
  /** Последний день многодневного события, ГГГГ-ММ-ДД. */
  endDate?: string
  /**
   * У дня многодневного события: исходные первый день и время. start/end дня — отрезок этого дня
   * (первый — до полуночи, последний — с полуночи, средние — на весь день).
   */
  span?: { date: string; start: number; end: number; allDay?: boolean }
  /** Кого владелец пригласил и что они ответили. */
  attendees?: Attendee[]
  /** Чужая встреча, куда пригласили: от кого и мой ответ. Такое событие — только для чтения. */
  invite?: Invite
  /** Задача, под которую поставлено это время (план ассистента). */
  taskId?: string
}

export type Rsvp = 'pending' | 'accepted' | 'declined'
export type Attendee = { username: string; name: string; status: Rsvp }
export type Invite = { from: User; status: Rsvp }

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
  notes?: string
  url?: string
  travel?: number
  /** Последний день многодневного события (end — время в этот день). */
  endDate?: string
  /** Логины, кого пригласить. */
  attendees?: string[]
  /** Задача, под которую ставится это время. */
  taskId?: string
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
  /** '' очищает заметки и ссылку; endDate: '' — снова однодневное. */
  notes?: string
  url?: string
  travel?: number
  endDate?: string
  /** Новый полный список приглашённых (логины). */
  attendees?: string[]
}

/** Значки событий по числам месяца. */
export type MonthDots = Readonly<Record<number, readonly Badge[]>>

export type ChatMessage = { id: number; role: 'user' | 'ai'; text: string }

/** Тег задачи — свободный текст; PRESET_TAGS в PrepCard дают подсказки с иконками. */
export type TaskCategory = string
export type TaskKind = 'task' | 'goal' | 'habit'

/** Как часто делается привычка: каждый день, по будням, раз в неделю. */
export type Cadence = 'daily' | 'weekdays' | 'weekly'

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
  /** Уведомление о встрече: какой день открыть. */
  eventId?: string
  date?: string
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
  /** Когда задачу завели (ISO). */
  createdAt?: string
  /** Сколько минут займёт (нет — час при планировании). */
  estimate?: number
  /** Когда закрыли (ISO), ставит сервер. */
  doneAt?: string
  /** У привычки: частота и дни, когда она выполнена (ГГГГ-ММ-ДД, по порядку). */
  cadence?: Cadence
  checks?: string[]
}

/** Новая задача (до сохранения). members — логины участников, с которыми поделиться. */
export type NewTask = {
  title: string
  subtitle?: string
  kind?: TaskKind
  category?: TaskCategory
  due?: string
  members?: string[]
  estimate?: number
  cadence?: Cadence
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
  /** 0 — без оценки. */
  estimate?: number
  cadence?: Cadence
  /** Отметить привычку выполненной в этот день (ГГГГ-ММ-ДД) или снять отметку. */
  check?: string
  uncheck?: string
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

// --- Персонализация ассистента (server/internal/model/personal.go) ----------------------

export type Focus = 'none' | 'morning' | 'afternoon' | 'evening'

/** «Святой» отрезок дня: ассистент его не занимает. days — дни недели (0 — воскресенье), пусто — каждый день. */
export type ProtectedBlock = { title: string; start: number; end: number; days?: number[] }

export type SuggestionKind = 'lunch' | 'stale_task' | 'date' | 'overload' | 'plan_tasks'

/** Что делает «Да»: event — создать событие, task — задачу, chat — открыть чат с запросом. */
export type SuggestionAction =
  | { type: 'event'; title: string; date: string; start: number; end: number; badge?: Badge }
  | { type: 'task'; title: string; due?: string }
  | { type: 'chat'; prompt: string }

/** Предложение ассистента: он сам заметил, что можно улучшить в расписании. */
export type Suggestion = {
  id: number
  kind: SuggestionKind
  key: string
  title: string
  body: string
  action: SuggestionAction
  status: 'pending' | 'accepted' | 'dismissed'
  createdAt: string
  expiresAt: string
}

/** Что пользователь рассказал о себе. Время — минуты от полуночи. */
export type Profile = {
  wakeUp: number
  /** ≤ wakeUp — ложится после полуночи. */
  bedTime: number
  workStart: number
  workEnd: number
  workDays: number[]
  focus: Focus
  meetingMinutes: number
  bufferMinutes: number
  protected: ProtectedBlock[]
  tone: 'brief' | 'detailed'
  address: 'ty' | 'vy'
  about?: string
  /** Ассистент запоминает факты из разговоров. */
  memory: boolean
  /** Предложений ассистента в день (0 — не присылать) и выключенные виды. */
  proactive: number
  muted?: SuggestionKind[]
  /** Анкета при первом входе пройдена или пропущена. */
  onboarded: boolean
}

export type ProfilePatch = Partial<Profile>

export type MemoryKind = 'person' | 'place' | 'habit' | 'preference' | 'rule' | 'date' | 'other'

/** Факт в памяти ассистента. source: inferred — догадка по поведению (ждёт «Верно» / «Нет»). */
export type Memory = {
  id: number
  kind: MemoryKind
  text: string
  /** ГГГГ-ММ-ДД или --ММ-ДД (каждый год). */
  date?: string
  source: 'user' | 'inferred'
  confirmed: boolean
  key?: string
  createdAt: string
  updatedAt: string
  /** Когда факт последний раз пригодился ассистенту. */
  usedAt?: string
}

export type MemoryPatch = { kind?: MemoryKind; text?: string; date?: string; confirmed?: boolean; rejected?: boolean }

/** Карточка человека из окружения пользователя. */
export type Person = {
  id: number
  name: string
  aliases?: string[]
  relation?: string
  place?: string
  /** Обычная длительность встречи; 0/нет — как в профиле. */
  meetingMinutes?: number
  /** ГГГГ-ММ-ДД или --ММ-ДД. */
  birthday?: string
  notes?: string
  /** Логин на сервере. */
  username?: string
}

export type PersonInput = Omit<Person, 'id'>

/** Результат поиска: события (серия — ближайшим вхождением, предстоящие первыми) и задачи. */
export type SearchResult = { events: DatedEvent[]; tasks: Task[] }

/** Вход с устройства: id — начало хэша токена, label — «Chrome · Android». */
export type AuthSession = { id: string; label: string; createdAt: string; lastSeen: string; current?: boolean }

/** Обзор недели с понедельника `start` (минуты). */
export type WeekInsights = {
  start: string
  days: { date: string; minutes: number; events: number }[]
  byBadge: Partial<Record<Badge, number>>
  minutes: number
  /** В среднем за четыре прошлые недели. */
  average: number
  /** Свободные отрезки от 90 минут в рабочие часы. */
  focus: number
  /** Задачи, закрытые на этой неделе. */
  done: number
  busiest?: string
}
