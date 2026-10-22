import type { Badge, Memory, MemoryKind, PersonInput, Profile, SuggestionKind } from './types'

/** Пределы профиля и памяти — те же, что в server/internal/model/personal.go. */
export const PROFILE_LIMITS = {
  protectedBlocks: 10,
  blockTitle: 40,
  about: 500,
  proactive: 3,
  memoryText: 300,
  personField: 80,
  personNotes: 500,
  personAliases: 5,
  memories: 300,
  people: 200,
} as const

export const DEFAULT_PROFILE: Profile = {
  wakeUp: 7 * 60,
  bedTime: 23 * 60,
  workStart: 9 * 60,
  workEnd: 18 * 60,
  workDays: [1, 2, 3, 4, 5],
  focus: 'none',
  meetingMinutes: 60,
  bufferMinutes: 0,
  protected: [],
  tone: 'brief',
  address: 'ty',
  memory: true,
  proactive: 2,
  onboarded: false,
}

export const SUGGESTION_KINDS: readonly { id: SuggestionKind; label: string }[] = [
  { id: 'plan_tasks', label: 'Разложить задачи по свободным окнам' },
  { id: 'lunch', label: 'Обед в плотный день' },
  { id: 'stale_task', label: 'Давно отложенные задачи' },
  { id: 'date', label: 'Дни рождения и важные даты' },
  { id: 'overload', label: 'Перегруз встречами' },
]

/** Дни недели в порядке показа (с понедельника); индекс значения — как у Date.getDay(). */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const
export const SHORT_WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'] as const

/** «пн–пт», «пн, ср, пт», «каждый день» — как daysLabel на сервере. */
export function daysLabel(days: readonly number[] | undefined): string {
  if (!days || days.length === 0 || new Set(days).size === 7) return 'каждый день'
  const pos = WEEK_ORDER.map((d, i) => (days.includes(d) ? i : -1)).filter((i) => i >= 0)
  const parts: string[] = []
  for (let i = 0; i < pos.length;) {
    let j = i
    while (j + 1 < pos.length && pos[j + 1] === (pos[j] ?? 0) + 1) j++
    const name = (k: number) => SHORT_WEEKDAYS[WEEK_ORDER[pos[k] ?? 0] ?? 0]
    if (j === i) parts.push(name(i))
    else if (j === i + 1) parts.push(name(i), name(j))
    else parts.push(`${name(i)}–${name(j)}`)
    i = j + 1
  }
  return parts.join(', ')
}

const length = (s: string) => [...s].length
const validDays = (days: readonly number[] | undefined) =>
  (days ?? []).every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
const isMinute = (v: number, max: number) => Number.isInteger(v) && v >= 0 && v <= max

/** Первая ошибка профиля или null — те же правила, что validateProfile на сервере. */
export function profileError(p: Profile): string | null {
  if (!isMinute(p.wakeUp, 1439) || !isMinute(p.bedTime, 1440))
    return 'Подъём и отбой — время суток (минуты от полуночи)'
  if (!isMinute(p.workStart, 1440) || !isMinute(p.workEnd, 1440) || p.workEnd <= p.workStart)
    return 'Рабочее время задано неверно: конец должен быть позже начала'
  if (!validDays(p.workDays)) return 'Рабочие дни — числа от 0 (воскресенье) до 6'
  if (!['none', 'morning', 'afternoon', 'evening'].includes(p.focus))
    return 'focus: none, morning, afternoon или evening'
  if (!Number.isInteger(p.meetingMinutes) || p.meetingMinutes < 15 || p.meetingMinutes > 480)
    return 'Обычная встреча — от 15 минут до 8 часов'
  if (!isMinute(p.bufferMinutes, 60)) return 'Перерыв между делами — от 0 до 60 минут'
  if (p.protected.length > PROFILE_LIMITS.protectedBlocks)
    return `Не больше ${PROFILE_LIMITS.protectedBlocks} защищённых блоков`
  for (const b of p.protected) {
    const n = length(b.title.trim())
    if (n === 0 || n > PROFILE_LIMITS.blockTitle)
      return `Название блока обязательно и не длиннее ${PROFILE_LIMITS.blockTitle} символов`
    if (!isMinute(b.start, 1440) || !isMinute(b.end, 1440) || b.end <= b.start)
      return `Блок «${b.title}»: конец должен быть позже начала`
    if (!validDays(b.days)) return `Блок «${b.title}»: дни недели — числа от 0 до 6`
  }
  if (p.tone !== 'brief' && p.tone !== 'detailed') return 'tone: brief или detailed'
  if (p.address !== 'ty' && p.address !== 'vy') return 'address: ty или vy'
  if (length(p.about ?? '') > PROFILE_LIMITS.about) return `«О себе» — не длиннее ${PROFILE_LIMITS.about} символов`
  if (!Number.isInteger(p.proactive) || p.proactive < 0 || p.proactive > PROFILE_LIMITS.proactive)
    return `Предложений в день — от 0 до ${PROFILE_LIMITS.proactive}`
  for (const k of p.muted ?? []) {
    if (!SUGGESTION_KINDS.some((s) => s.id === k)) return `Неизвестный вид предложений: «${k}»`
  }
  return null
}

/** Профиль после патча — как apply на сервере: дни по порядку и без повторов, тексты без пробелов по краям. */
export function applyProfilePatch(p: Profile, patch: Partial<Profile>): Profile {
  const days = (d: readonly number[]) => [...new Set(d)].sort((a, b) => a - b)
  const next: Profile = { ...p, ...patch }
  if (patch.workDays) next.workDays = days(patch.workDays)
  if (patch.protected)
    next.protected = patch.protected.map((b) => ({
      ...b,
      title: b.title.trim(),
      days: b.days?.length ? days(b.days) : undefined,
    }))
  if (patch.about !== undefined) next.about = patch.about.trim() || undefined
  if (patch.muted) next.muted = [...new Set(patch.muted)].sort()
  return next
}

export const MEMORY_KINDS: readonly { id: MemoryKind; label: string; plural: string }[] = [
  { id: 'rule', label: 'Правило', plural: 'Правила' },
  { id: 'preference', label: 'Предпочтение', plural: 'Предпочтения' },
  { id: 'habit', label: 'Привычка', plural: 'Привычки' },
  { id: 'date', label: 'Дата', plural: 'Даты' },
  { id: 'place', label: 'Место', plural: 'Места' },
  { id: 'person', label: 'Человек', plural: 'Люди' },
  { id: 'other', label: 'Другое', plural: 'Другое' },
]

/** «ГГГГ-ММ-ДД» или «--ММ-ДД» (каждый год); пусто — без даты. */
export function isMemoryDate(v: string | undefined): boolean {
  if (!v) return true
  const yearly = /^--(\d{2})-(\d{2})$/.exec(v)
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  const [y, m, d] = yearly ? [2000, Number(yearly[1]), Number(yearly[2])] : full ? full.slice(1).map(Number) : []
  if (y === undefined || m === undefined || d === undefined) return false
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

export const memoryTextError = (text: string) => {
  const n = length(text.trim())
  return n > 0 && n <= PROFILE_LIMITS.memoryText
    ? null
    : `Факт обязателен и не длиннее ${PROFILE_LIMITS.memoryText} символов`
}

/** Первая ошибка карточки человека или null — правила personInput на сервере. */
export function personError(p: PersonInput): string | null {
  const name = length(p.name.trim())
  if (name === 0 || name > PROFILE_LIMITS.personField)
    return `Имя обязательно и не длиннее ${PROFILE_LIMITS.personField} символов`
  const aliases = new Set((p.aliases ?? []).map((a) => a.trim()).filter(Boolean))
  if (aliases.size > PROFILE_LIMITS.personAliases) return `Не больше ${PROFILE_LIMITS.personAliases} других имён`
  for (const f of [p.relation, p.place, ...aliases]) {
    if (f && length(f) > PROFILE_LIMITS.personField)
      return `Поля карточки — не длиннее ${PROFILE_LIMITS.personField} символов`
  }
  const mm = p.meetingMinutes ?? 0
  if (mm !== 0 && (!Number.isInteger(mm) || mm < 15 || mm > 480)) return 'Длительность встречи — от 15 минут до 8 часов'
  if (!isMemoryDate(p.birthday?.trim())) return 'День рождения — ГГГГ-ММ-ДД или --ММ-ДД'
  if (length(p.notes ?? '') > PROFILE_LIMITS.personNotes)
    return `Заметка — не длиннее ${PROFILE_LIMITS.personNotes} символов`
  const username = p.username?.trim().replace(/^@/, '')
  if (username && !/^[a-zA-Z][a-zA-Z0-9_.-]{2,23}$/.test(username)) return 'Логин — латиница, 3–24 знака'
  return null
}

/** Карточка в виде, в каком её сохраняет сервер: без пробелов по краям и повторов имён. */
export function normalizePerson(p: PersonInput): PersonInput {
  const opt = (s: string | undefined) => s?.trim() || undefined
  const aliases = [...new Set((p.aliases ?? []).map((a) => a.trim()).filter(Boolean))]
  return {
    name: p.name.trim(),
    aliases: aliases.length ? aliases : undefined,
    relation: opt(p.relation),
    place: opt(p.place),
    meetingMinutes: p.meetingMinutes || undefined,
    birthday: opt(p.birthday),
    notes: opt(p.notes),
    username: opt(p.username?.replace(/^@/, ''))?.toLowerCase(),
  }
}

/** «14 марта» для --03-14, «14 марта 1990» для полной даты. */
export function memoryDateLabel(v: string): string {
  const months = [
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря',
  ]
  const yearly = /^--(\d{2})-(\d{2})$/.exec(v)
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (yearly) return `${Number(yearly[2])} ${months[Number(yearly[1]) - 1] ?? ''}`
  if (full) return `${Number(full[3])} ${months[Number(full[2]) - 1] ?? ''} ${full[1]}`
  return v
}

/**
 * Обычная длительность событий этого типа — из подтверждённой догадки ассистента
 * («Обычно спорт длится 1,5 ч», ключ `duration:sport:90`). Нет такой — null.
 */
export function habitDuration(memories: readonly Memory[], badge: Badge): number | null {
  for (const m of memories) {
    if (!m.confirmed || !m.key?.startsWith(`duration:${badge}:`)) continue
    const minutes = Number(m.key.slice(`duration:${badge}:`.length))
    if (Number.isInteger(minutes) && minutes >= 15 && minutes <= 480) return minutes
  }
  return null
}
