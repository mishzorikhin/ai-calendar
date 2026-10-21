import { AnimatePresence } from 'framer-motion'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { apiErrorText } from '../api/api'
import { useApi } from '../api/provider'
import {
  useCalendarName,
  useCreateEvent,
  useDayEvents,
  useDeleteEvent,
  usePrimaryCalendar,
  useUpdateEvent,
} from '../api/queries'
import { useAssistant } from '../app/assistant'
import { useCalendar } from '../app/calendar'
import { useComposer, type ComposerRequest } from '../app/composer'
import { useNavigation } from '../app/navigation'
import { TIME_OPTIONS, firstFreeTime, fitDuration, nearestTimeOption, nextFreeTime, slotAt } from '../domain/calendar'
import { minutesOf, useNow } from '../lib/hooks'
import {
  addDays,
  formatMinutes,
  fromISODate,
  isSameDay,
  parseMinutes,
  relativeDayLabel,
  startOfDay,
  toISODate,
} from '../lib/dates'
import { BADGE_OPTIONS } from '../lib/badges'
import { BADGE_ICON } from './Icons'
import { repeatLabel } from '../domain/repeat'
import type { Badge, Repeat } from '../domain/types'
import { BottomSheet } from './BottomSheet'
import { CalendarIcon, ClockIcon, CloseIcon, InfinityIcon, RepeatIcon, TrashIcon } from './Icons'
import { ComposerStatus, NativePicker } from './EventComposerParts'
import { ReadOnlyEvent } from './ReadOnlyEvent'
import { ReminderPicker, reminderValue, useDefaultReminder } from './ReminderPicker'
import { RepeatPicker } from './RepeatPicker'
import { CircleButton, Pill, Pressable } from './ui'
import styles from './EventComposer.module.css'

const DURATIONS = [
  { value: 30, label: '30 мин' },
  { value: 60, label: '1 ч' },
  { value: 90, label: '1,5 ч' },
  { value: 120, label: '2 ч' },
  { value: 180, label: '3 ч' },
  { value: 240, label: '4 ч' },
  { value: 360, label: '6 ч' },
  { value: 480, label: '8 ч' },
] as const

/** Сколько ближайших дней предлагаем в композере. */
const DAY_CHOICES = 14

const FORM_ID = 'event-composer'

/** Шторка события: «+» или тап по пустому времени — создание; тап по событию — правка и удаление. */
export function EventComposer() {
  const { request, close } = useComposer()
  return (
    <AnimatePresence>
      {request &&
        (request.event?.readOnly ? (
          <ReadOnlyEvent key="read-only" event={request.event} onClose={close} />
        ) : (
          <Composer key="composer" request={request} onClose={close} />
        ))}
    </AnimatePresence>
  )
}

/** Вставляет value в отсортированный список, если его там ещё нет. */
function withExtra(list: readonly number[], value?: number | null): number[] {
  if (value == null || list.includes(value)) return [...list]
  return [...list, value].sort((a, b) => a - b)
}

/** Плавно (или сразу, при открытии) ставит выбранную пилюлю ленты в центр. */
function centerActive(row: HTMLElement | null, smooth: boolean) {
  const active = row?.querySelector<HTMLElement>('[aria-pressed="true"]')
  if (!row || !active) return
  const a = active.getBoundingClientRect()
  const r = row.getBoundingClientRect()
  const left = row.scrollLeft + a.left - r.left - r.width / 2 + a.width / 2
  row.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' })
}

function durationLabel(mins: number): string {
  if (mins % 60 === 0) return `${mins / 60} ч`
  if (mins % 30 === 0) return `${mins / 60}`.replace('.', ',') + ' ч'
  return `${mins} мин`
}

function Composer({ request, onClose }: { request: ComposerRequest; onClose: () => void }) {
  const editing = request.event
  const { setSelectedDate } = useCalendar()
  const createEvent = useCreateEvent()
  const updateEvent = useUpdateEvent()
  const deleteEvent = useDeleteEvent()
  const { route, go } = useNavigation()
  const { setDraft } = useAssistant()
  // Куда уйдёт событие: календарь, откуда оно пришло, или основной для новых.
  const sourceCalendar = useCalendarName(editing?.source)
  const primaryCalendar = usePrimaryCalendar()
  const syncTarget = editing ? sourceCalendar : primaryCalendar

  const [title, setTitle] = useState(editing?.title ?? '')
  const [subtitle, setSubtitle] = useState(editing?.subtitle ?? '')
  const [date, setDate] = useState(request.date)
  const [pickedStart, setStart] = useState<number | null>(
    editing ? editing.start : request.start !== null ? nearestTimeOption(request.start) : null,
  )
  const [duration, setDuration] = useState<number>(editing ? editing.end - editing.start : 60)
  const [badge, setBadge] = useState<Badge>(editing?.badge ?? 'routine')
  // Напоминание: null — не трогали (у нового события сработает настройка по умолчанию), −1 — не напоминать.
  const [reminder, setReminder] = useState<number | null>(null)
  const remindersOn = useApi().mode === 'server'
  const defaultReminder = useDefaultReminder(badge)
  // Повтор — только у своих событий: у подключённых календарей он задаётся там.
  const [repeat, setRepeat] = useState<Repeat | ''>(editing?.repeat ?? '')
  const series = editing?.repeat
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [titleMissing, setTitleMissing] = useState(false)
  const titleInput = useRef<HTMLInputElement>(null)
  const days = useRef<HTMLDivElement>(null)
  const times = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)

  const { events } = useDayEvents(date, { keepPrevious: false })
  const now = useNow()
  // Сколько минут сегодняшнего дня уже прошло; для других дней — ничего.
  const passed = isSameDay(date, now) ? minutesOf(now) : -1
  // Другие события дня — для подсчёта свободного времени (себя при правке не считаем).
  const others = events.filter((e) => e.id !== editing?.id)
  const start = pickedStart ?? firstFreeTime(others, Math.max(passed, 0))
  // Поздний старт + длинное событие не должны вылезать за полночь — укорачиваем до 24:00.
  const length = fitDuration(start, duration)
  const end = start + length

  const today = startOfDay(now)
  const dates = Array.from({ length: DAY_CHOICES }, (_, i) => addDays(today, i))
  if (!dates.some((d) => isSameDay(d, date))) {
    dates.push(date)
    dates.sort((a, b) => a.getTime() - b.getTime())
  }

  // Точное время из системного выбора или «сдвига» встаёт в ленту отдельной пилюлей.
  const startOptions = withExtra(withExtra(TIME_OPTIONS, editing?.start), start)
  const durations = withExtra(
    DURATIONS.map((d) => d.value),
    editing ? editing.end - editing.start : null,
  )

  const conflicts = slotAt(others, start, length).conflicts
  const shift = conflicts.length ? nextFreeTime(others, start, length) : null

  // Выбранные день и время всегда на виду: при открытии ленты сразу стоят на них,
  // а после выбора (в том числе из системного календаря) плавно доезжают.
  useLayoutEffect(() => centerActive(days.current, mounted.current), [date])
  useLayoutEffect(() => centerActive(times.current, mounted.current), [start])
  useEffect(() => {
    mounted.current = true
  }, [])

  // Новое событие начинается с названия. При правке фокус не трогаем — там чаще двигают время.
  useEffect(() => {
    if (!editing) titleInput.current?.focus({ preventScroll: true })
  }, [editing])

  const pending = createEvent.isPending || updateEvent.isPending || deleteEvent.isPending
  const error = createEvent.error ?? updateEvent.error ?? deleteEvent.error

  const reminders = reminder === null ? {} : { reminders: reminder < 0 ? [] : [reminder] }

  const save = () => {
    const name = title.trim()
    // Безымянное событие в календаре потом не опознать — просим название, а не подставляем заглушку.
    if (!name && !editing) {
      setTitleMissing(true)
      titleInput.current?.focus()
      return
    }
    if (editing) {
      updateEvent.mutate(
        {
          event: editing,
          patch: {
            title: name || editing.title,
            subtitle: subtitle.trim(),
            // У вхождения серии день передаём, только если его меняют (или снимают повтор):
            // тогда сервер сдвигает серию от occurrence, а без них правка не трогает её начало.
            ...(!series || !isSameDay(date, editing.date) || repeat === '' ? { date } : {}),
            start,
            end,
            badge,
            ...reminders,
            ...(repeat !== (editing.repeat ?? '') && { repeat }),
            ...(series && (!isSameDay(date, editing.date) || repeat === '') && { occurrence: editing.date }),
          },
        },
        { onSuccess: onClose },
      )
      return
    }
    createEvent.mutate(
      { title: name, subtitle: subtitle.trim(), start, end, date, badge, ...reminders, ...(repeat && { repeat }) },
      {
        onSuccess: () => {
          setSelectedDate(date)
          onClose()
          if (route !== 'day') go('day')
        },
      },
    )
  }

  const remove = () => {
    if (!editing) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    deleteEvent.mutate(editing, { onSuccess: onClose })
  }

  /** Убрать из серии только этот день. */
  const skipDay = () => {
    if (editing) updateEvent.mutate({ event: editing, patch: { skip: editing.date } }, { onSuccess: onClose })
  }

  const delegate = () => {
    setDraft(title.trim() ? `Запланируй: ${title.trim()}` : '')
    onClose()
    go('chat')
  }

  return (
    <BottomSheet
      label={editing ? 'Изменить событие' : 'Новое событие'}
      onClose={onClose}
      footer={
        <div className={styles.actions}>
          <ComposerStatus start={start} end={end} conflicts={conflicts} shift={shift} onShift={setStart} />
          {error && (
            <p className={styles.error} role="alert">
              {apiErrorText(error)}
            </p>
          )}
          {editing && series && confirmDelete ? (
            <div className={styles.deleteChoice} role="group" aria-label="Что удалить">
              <Pressable className={`${styles.delete} ${styles.deleteSure}`} onClick={skipDay} disabled={pending}>
                Только этот день
              </Pressable>
              <Pressable className={`${styles.delete} ${styles.deleteSure}`} onClick={remove} disabled={pending}>
                Всю серию
              </Pressable>
            </div>
          ) : (
            editing && (
              <Pressable
                className={`${styles.delete} ${confirmDelete ? styles.deleteSure : ''}`}
                onClick={remove}
                disabled={pending}
                aria-label={confirmDelete ? 'Подтвердить удаление' : 'Удалить событие'}
              >
                <TrashIcon size={17} />
                {confirmDelete ? 'Точно удалить?' : 'Удалить'}
              </Pressable>
            )
          )}
          <Pill tone="dark" type="submit" form={FORM_ID} className={styles.create} disabled={pending}>
            {pending ? 'Сохраняю…' : editing ? 'Сохранить' : 'Создать событие'}
          </Pill>
          {!editing && (
            <Pressable className={styles.delegate} onClick={delegate}>
              <InfinityIcon size={18} />
              Поручить ассистенту
            </Pressable>
          )}
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
        <div className={styles.head}>
          <h2>{editing ? 'Изменить событие' : 'Новое событие'}</h2>
          <CircleButton tone="gray" size={44} onClick={onClose} aria-label="Закрыть">
            <CloseIcon size={18} />
          </CircleButton>
        </div>

        {syncTarget && !repeat && (
          <p className={styles.syncNote}>
            <CalendarIcon size={14} />
            {editing ? `Изменения уйдут в «${syncTarget}»` : `Сохранится и в «${syncTarget}»`}
          </p>
        )}
        {series && (
          <p className={styles.syncNote}>
            <RepeatIcon size={14} />
            {repeatLabel(series)} — изменения для всей серии
          </p>
        )}

        <input
          ref={titleInput}
          id="event-title"
          className={styles.title}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            setTitleMissing(false)
          }}
          placeholder="Название, например «Звонок маме»"
          aria-label="Название"
          aria-invalid={titleMissing || undefined}
          aria-describedby={titleMissing ? 'event-title-hint' : undefined}
          enterKeyHint="done"
        />
        {titleMissing && (
          <p id="event-title-hint" className={styles.hint} role="alert">
            Как назвать событие?
          </p>
        )}
        <input
          className={styles.subtitle}
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          placeholder="Место или заметка — необязательно"
          aria-label="Место или заметка"
          enterKeyHint="done"
        />

        <div className={styles.labelRow}>
          <p className={styles.label} id="composer-day">
            День
          </p>
          {/* Любая дата — через системный выбор: на телефоне это привычный календарь. */}
          <NativePicker
            type="date"
            value={toISODate(date)}
            label="Выбрать дату в календаре"
            icon={<CalendarIcon size={14} />}
            onPick={(v) => setDate(fromISODate(v))}
          >
            Выбрать дату
          </NativePicker>
        </div>
        <div ref={days} className={`${styles.row} scroll-x`} role="group" aria-labelledby="composer-day">
          {dates.map((d) => (
            <Pill
              key={d.toDateString()}
              small
              tone={isSameDay(d, date) ? 'dark' : 'ghost'}
              aria-pressed={isSameDay(d, date)}
              onClick={() => setDate(d)}
            >
              {relativeDayLabel(d, today)}
            </Pill>
          ))}
        </div>

        <div className={styles.labelRow}>
          <p className={styles.label} id="composer-start">
            Начало
          </p>
          <NativePicker
            type="time"
            value={formatMinutes(start)}
            label="Указать точное время"
            icon={<ClockIcon size={14} />}
            onPick={(v) => {
              const mins = parseMinutes(v)
              if (mins !== null) setStart(mins)
            }}
          >
            Точное время
          </NativePicker>
        </div>
        <div ref={times} className={`${styles.row} scroll-x`} role="group" aria-labelledby="composer-start">
          {startOptions.map((t) => (
            <Pill
              key={t}
              small
              tone={t === start ? 'dark' : 'ghost'}
              aria-pressed={t === start}
              onClick={() => setStart(t)}
              // Прошедшее сегодня приглушаем, но не запрещаем: задним числом записать тоже бывает нужно.
              className={`tnum ${t !== start && t + 30 <= passed ? styles.past : ''}`}
            >
              {formatMinutes(t)}
            </Pill>
          ))}
        </div>

        <p className={styles.label} id="composer-duration">
          Длительность
        </p>
        <div className={`${styles.row} scroll-x`} role="group" aria-labelledby="composer-duration">
          {durations.map((d) => (
            <Pill
              key={d}
              small
              tone={d === duration ? 'dark' : 'ghost'}
              aria-pressed={d === duration}
              onClick={() => setDuration(d)}
            >
              {durationLabel(d)}
            </Pill>
          ))}
        </div>

        <p className={styles.label} id="composer-badge">
          Тип
        </p>
        <div className={`${styles.row} scroll-x`} role="group" aria-labelledby="composer-badge">
          {BADGE_OPTIONS.map(({ id, label }) => {
            const Icon = BADGE_ICON[id]
            return (
              <Pill
                key={id}
                small
                tone={id === badge ? 'dark' : 'ghost'}
                aria-pressed={id === badge}
                onClick={() => setBadge(id)}
                className={styles.badgePill}
              >
                <Icon size={14} /> {label}
              </Pill>
            )
          })}
        </div>

        {!editing?.source && <RepeatPicker value={repeat} onChange={setRepeat} />}

        {remindersOn && (
          <ReminderPicker
            value={reminder ?? reminderValue(editing?.reminders, defaultReminder)}
            isDefault={reminder === null && editing?.reminders == null}
            onChange={setReminder}
          />
        )}
      </form>
    </BottomSheet>
  )
}
