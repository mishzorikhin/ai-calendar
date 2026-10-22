import { fromISODate } from '../lib/dates'
import type { DatedEvent, NewEvent, NewTask, Task } from './types'

/**
 * Как вернуть удалённое событие: то, что создать заново, и дни серии, которые были убраны
 * (их снова убирают правкой «только этот день»). У нового события будет новый id.
 */
export function restoreEvent(e: DatedEvent): { input: NewEvent; skips: string[] } {
  const input: NewEvent = {
    title: e.title,
    // Серию восстанавливаем с её первого дня, а не с дня, в котором её удалили.
    date: e.repeat && e.seriesDate ? fromISODate(e.seriesDate) : e.date,
    start: e.start,
    end: e.end,
    badge: e.badge,
    ...(e.subtitle && { subtitle: e.subtitle }),
    ...(e.allDay && { allDay: true }),
    // null (по умолчанию) — не передаём, [] — «не напоминать» сохраняем.
    ...(e.reminders && { reminders: e.reminders }),
    ...(e.repeat && { repeat: e.repeat, ...(e.repeatUntil && { repeatUntil: e.repeatUntil }) }),
    ...(e.notes && { notes: e.notes }),
    ...(e.url && { url: e.url }),
    ...(e.travel && { travel: e.travel }),
    ...(e.endDate && { endDate: e.endDate }),
    ...(e.attendees?.length && { attendees: e.attendees.map((a) => a.username) }),
  }
  return { input, skips: e.repeat ? (e.exdates ?? []) : [] }
}

/** Как вернуть удалённую задачу (с участниками — по логинам). */
export function restoreTask(t: Task): { input: NewTask; done: boolean } {
  return {
    input: {
      title: t.title,
      kind: t.kind,
      ...(t.subtitle && { subtitle: t.subtitle }),
      ...(t.category && { category: t.category }),
      ...(t.due && { due: t.due }),
      ...(t.members?.length && { members: t.members.map((m) => m.username) }),
    },
    done: t.done,
  }
}
