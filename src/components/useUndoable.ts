import { useQueryClient } from '@tanstack/react-query'
import { useApi } from '../api/provider'
import { keys, useDeleteEvent, useDeleteTask, useUpdateEvent } from '../api/queries'
import { useUndo } from '../app/undo'
import { restoreEvent, restoreTask } from '../domain/undo'
import type { DatedEvent, Task } from '../domain/types'
import { formatMinutes, fromISODate } from '../lib/dates'

/**
 * Действия с плашкой «Отменить»: удаление события и задачи, перенос события.
 * Отмена удаления создаёт запись заново (со всеми полями, у серии — с убранными днями),
 * отмена переноса возвращает прежнее время. Сама отмена идёт прямо через API: шторка,
 * из которой удалили, к этому моменту уже закрыта.
 */
export function useUndoable() {
  const api = useApi()
  const qc = useQueryClient()
  const { offer } = useUndo()
  const updateEvent = useUpdateEvent()
  const deleteEvent = useDeleteEvent()
  const deleteTask = useDeleteTask()

  const refreshEvents = () => {
    void qc.invalidateQueries({ queryKey: keys.allEvents })
    void qc.invalidateQueries({ queryKey: keys.allMonths })
  }

  const removeEvent = (event: DatedEvent, opts?: { onSuccess?: () => void }) =>
    deleteEvent.mutate(event, {
      onSuccess: () => {
        opts?.onSuccess?.()
        offer(event.repeat ? `Серия «${event.title}» удалена` : `«${event.title}» удалено`, () => {
          const { input, skips } = restoreEvent(event)
          void (async () => {
            const created = await api.createEvent(input)
            for (const day of skips) await api.updateEvent(created.id, { skip: fromISODate(day) })
          })().finally(refreshEvents)
        })
      },
    })

  const moveEvent = (event: DatedEvent, next: { start: number; end: number }) => {
    if (next.start === event.start && next.end === event.end) return
    updateEvent.mutate(
      { event, patch: next },
      {
        onSuccess: () =>
          offer(`Теперь ${formatMinutes(next.start)}–${formatMinutes(next.end)}`, () => {
            void api.updateEvent(event.id, { start: event.start, end: event.end }).finally(refreshEvents)
          }),
      },
    )
  }

  /** Удалить задачу; у участника это выход из неё — такое не отменяем (вернуть доступ может только владелец). */
  const removeTask = (task: Task, opts?: { onSuccess?: () => void }) =>
    deleteTask.mutate(task.id, {
      onSuccess: () => {
        opts?.onSuccess?.()
        if (task.role === 'member') return
        offer(`«${task.title}» удалена`, () => {
          const { input, done } = restoreTask(task)
          void (async () => {
            const created = await api.createTask(input)
            if (done) await api.updateTask(created.id, { done: true })
          })().finally(() => void qc.invalidateQueries({ queryKey: keys.tasks }))
        })
      },
    })

  return {
    removeEvent,
    moveEvent,
    removeTask,
    pending: deleteEvent.isPending || deleteTask.isPending,
    error: deleteEvent.error ?? deleteTask.error ?? updateEvent.error,
  }
}
