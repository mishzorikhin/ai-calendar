import { useState } from 'react'
import { apiErrorText } from '../../api/api'
import { useApi } from '../../api/provider'
import { useCreateTask, useTaskMembers, useUpdateTask, useUserSearch } from '../../api/queries'
import { useUndoable } from '../../components/useUndoable'
import { useSession } from '../../api/session'
import { BottomSheet } from '../../components/BottomSheet'
import { CheckIcon, CloseIcon, TrashIcon } from '../../components/Icons'
import { Avatar, CircleButton, Pill, Pressable } from '../../components/ui'
import { toISODate } from '../../lib/dates'
import type { Task, TaskKind, User } from '../../domain/types'
import { userColor, userInitials } from '../../lib/avatar'
import { EstimateField } from './EstimateField'
import { TAG_PRESETS } from './tags'
import styles from './Home.module.css'

const FORM_ID = 'task-sheet'

/** Шторка задачи: без `task` — создание, с ним — правка и удаление. */
export function TaskSheet({ task, onClose }: { task?: Task; onClose: () => void }) {
  const api = useApi()
  const createTask = useCreateTask()
  const updateTask = useUpdateTask()
  const undoable = useUndoable()

  const [title, setTitle] = useState(task?.title ?? '')
  const [subtitle, setSubtitle] = useState(task?.subtitle ?? '')
  const [kind, setKind] = useState<TaskKind>(task?.kind ?? 'task')
  const [category, setCategory] = useState(task?.category ?? '')
  const [customTag, setCustomTag] = useState(
    task?.category && !TAG_PRESETS.some((p) => p.id === task.category) ? task.category : '',
  )
  const [due, setDue] = useState(task?.due ?? '')
  const [estimate, setEstimate] = useState(task?.estimate ?? 0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Логины, с которыми поделиться при создании (для существующей — live через API).
  const [pendingMembers, setPendingMembers] = useState<string[]>([])

  const pending = createTask.isPending || updateTask.isPending || undoable.pending
  const error = createTask.error ?? updateTask.error ?? undoable.error
  const tag = customTag.trim() || category

  const save = () => {
    const name = title.trim()
    if (!name) return
    if (task) {
      updateTask.mutate(
        {
          id: task.id,
          patch: {
            title: name,
            subtitle: subtitle.trim(),
            kind,
            category: tag,
            due: kind === 'goal' ? due : '',
            estimate: kind === 'task' ? estimate : 0,
          },
        },
        { onSuccess: onClose },
      )
      return
    }
    createTask.mutate(
      {
        title: name,
        subtitle: subtitle.trim(),
        kind,
        category: tag,
        due: kind === 'goal' && due ? due : undefined,
        estimate: kind === 'task' && estimate ? estimate : undefined,
        members: pendingMembers.length > 0 ? pendingMembers : undefined,
      },
      { onSuccess: onClose },
    )
  }

  const remove = () => {
    if (!task) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    undoable.removeTask(task, { onSuccess: onClose })
  }

  return (
    <BottomSheet
      label={task ? 'Изменить задачу' : 'Новая задача'}
      onClose={onClose}
      footer={
        <div className={styles.sheetActions}>
          {error && (
            <p className={styles.sheetError} role="alert">
              {apiErrorText(error)}
            </p>
          )}
          {task && (
            <Pressable
              className={`${styles.delete} ${confirmDelete ? styles.deleteSure : ''}`}
              onClick={remove}
              disabled={pending}
              aria-label={confirmDelete ? 'Подтвердить удаление' : 'Удалить задачу'}
            >
              <TrashIcon size={17} />
              {confirmDelete ? 'Точно удалить?' : 'Удалить'}
            </Pressable>
          )}
          <Pill
            tone="dark"
            type="submit"
            form={FORM_ID}
            className={styles.sheetSave}
            disabled={pending || !title.trim()}
          >
            {pending ? 'Сохраняю…' : task ? 'Сохранить' : 'Создать задачу'}
          </Pill>
        </div>
      }
    >
      <form
        id={FORM_ID}
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <div className={styles.tagSheetHead}>
          <h2>{task ? 'Изменить задачу' : 'Новая задача'}</h2>
          <CircleButton tone="gray" size={44} onClick={onClose} aria-label="Закрыть">
            <CloseIcon size={18} />
          </CircleButton>
        </div>

        <input
          className={styles.tagInput}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Что нужно сделать?"
          aria-label="Название"
          enterKeyHint="done"
        />
        <input
          className={styles.tagInput}
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          placeholder="Заметка — необязательно"
          aria-label="Заметка"
          enterKeyHint="done"
        />

        <p className={styles.sheetLabel}>Вид</p>
        <div className={styles.tagRow}>
          <Pill
            small
            tone={kind === 'task' ? 'dark' : 'ghost'}
            aria-pressed={kind === 'task'}
            onClick={() => setKind('task')}
          >
            Задача
          </Pill>
          <Pill
            small
            tone={kind === 'goal' ? 'dark' : 'ghost'}
            aria-pressed={kind === 'goal'}
            onClick={() => setKind('goal')}
          >
            Цель
          </Pill>
        </div>

        {kind === 'task' && <EstimateField value={estimate} onChange={setEstimate} />}

        {kind === 'goal' && (
          <>
            <p className={styles.sheetLabel}>Дедлайн</p>
            <input
              className={styles.tagInput}
              type="date"
              value={due}
              min={toISODate(new Date())}
              onChange={(e) => setDue(e.target.value)}
              aria-label="Дедлайн цели"
            />
          </>
        )}

        <p className={styles.sheetLabel}>Тег</p>
        <div className={styles.tagRow}>
          {TAG_PRESETS.map(({ id, icon: Icon, label }) => (
            <Pill
              key={id}
              small
              tone={category === id && !customTag.trim() ? 'dark' : 'ghost'}
              aria-pressed={category === id}
              onClick={() => {
                setCustomTag('')
                setCategory(category === id ? '' : id)
              }}
              className={styles.tagPill}
            >
              <Icon size={14} /> {label}
            </Pill>
          ))}
        </div>
        <input
          className={styles.tagInput}
          value={customTag}
          onChange={(e) => setCustomTag(e.target.value)}
          placeholder="Или свой тег…"
          aria-label="Свой тег"
          maxLength={24}
          enterKeyHint="done"
        />

        {api.mode === 'server' && (
          <MembersField task={task} pending={pendingMembers} onPendingChange={setPendingMembers} />
        )}
      </form>
    </BottomSheet>
  )
}

/**
 * Участники задачи: чипы с аватарками + поле «@логин» с подсказками.
 * У существующей задачи добавление/удаление идёт сразу в API; у новой —
 * логины копятся и уезжают в members при создании. @упоминание в названии
 * или заметке тоже делит задачу — сервер распарсит его сам.
 */
function MembersField({
  task,
  pending,
  onPendingChange,
}: {
  task?: Task
  pending: string[]
  onPendingChange: (names: string[]) => void
}) {
  const session = useSession()
  const members = useTaskMembers()
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)

  const taken = new Set([...(task?.members ?? []).map((m) => m.username), ...pending, session?.user.username ?? ''])
  const q = query.trim().replace(/^@/, '').toLowerCase()
  const { data: found = [] } = useUserSearch(q)
  const suggestions = found.filter((u) => !taken.has(u.username)).slice(0, 5)

  const memberError = members.add.error ?? members.remove.error
  const isOwner = !task || task.role !== 'member'

  const add = (u: User) => {
    setQuery('')
    if (task) members.add.mutate({ taskId: task.id, username: u.username })
    else onPendingChange([...pending, u.username])
  }

  const remove = (username: string) => {
    if (task) members.remove.mutate({ taskId: task.id, username })
    else onPendingChange(pending.filter((n) => n !== username))
  }

  return (
    <>
      <p className={styles.sheetLabel}>Вместе с кем-то</p>
      <div className={styles.memberRow}>
        {task?.owner && task.role === 'member' && (
          <span className={`${styles.memberChip} ${styles.memberOwner}`} title="владелец задачи">
            <Avatar initials={userInitials(task.owner)} color={userColor(task.owner.username)} size={24} ring={false} />
            @{task.owner.username}
          </span>
        )}
        {(task ? (task.members ?? []) : pending.map((n) => ({ id: 0, username: n, name: n }))).map((u) => (
          <span key={u.username} className={styles.memberChip}>
            <Avatar initials={userInitials(u)} color={userColor(u.username)} size={24} ring={false} />@{u.username}
            {(isOwner || u.username === session?.user.username) && (
              <Pressable
                className={styles.memberX}
                onClick={() => remove(u.username)}
                aria-label={task && u.username === session?.user.username ? 'Выйти из задачи' : `Убрать @${u.username}`}
              >
                <CloseIcon size={12} strokeWidth={2.4} />
              </Pressable>
            )}
          </span>
        ))}
      </div>
      {/* Подсказки открыты, пока фокус внутри поля или списка: уход Tab-ом к варианту их не закрывает. */}
      <div
        className={styles.memberInputWrap}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setFocused(false)
        }}
      >
        <input
          className={styles.tagInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            const first = suggestions[0]
            if (e.key === 'Enter' && first) {
              e.preventDefault()
              add(first)
            }
            if (e.key === 'Escape') setQuery('')
          }}
          placeholder="@логин — поделиться задачей"
          aria-label="Добавить участника по логину"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
        />
        {focused && suggestions.length > 0 && (
          // mousedown не забирает фокус у поля (Safari не фокусирует кнопки по клику) — выбор успевает сработать.
          <ul className={styles.memberDrop} role="listbox" onMouseDown={(e) => e.preventDefault()}>
            {suggestions.map((u) => (
              <li key={u.id}>
                <Pressable className={styles.memberOption} onClick={() => add(u)} role="option" aria-selected="false">
                  <Avatar initials={userInitials(u)} color={userColor(u.username)} size={28} ring={false} />
                  <span className={styles.memberOptionText}>
                    <span>{u.name || u.username}</span>
                    <span className="caption">@{u.username}</span>
                  </span>
                  <CheckIcon size={15} className={styles.memberPick} />
                </Pressable>
              </li>
            ))}
          </ul>
        )}
      </div>
      {memberError && (
        <p className={styles.sheetError} role="alert">
          {apiErrorText(memberError)}
        </p>
      )}
      <p className={styles.memberHint}>Подсказка: @логин прямо в названии тоже поделится задачей</p>
    </>
  )
}
