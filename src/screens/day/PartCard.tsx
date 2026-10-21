import { AnimatePresence, m } from 'framer-motion'
import { useEffect, useEffectEvent, useLayoutEffect, useRef, type MouseEvent } from 'react'
import { MoonIcon, PlusIcon, SunIcon } from '../../components/Icons'
import { Pressable } from '../../components/ui'
import { firstFreeTime } from '../../domain/calendar'
import type { CalendarEvent, DayPart } from '../../domain/types'
import { formatMinutes } from '../../lib/dates'
import { spring } from '../../lib/motion'
import { pluralize } from '../../lib/plural'
import { EventCard, HOUR_H } from './EventCard'
import styles from './Day.module.css'

const PART_ICON = { morning: SunIcon, afternoon: SunIcon, night: MoonIcon } as const

/** Слой части суток: свёрнутый — заголовок с числом событий, раскрытый — шкала времени. */
export function PartCard({
  part,
  index,
  expanded,
  onOpen,
  events,
  dateKey,
  nowMins,
  onCreate,
  onEvent,
}: {
  part: DayPart
  index: number
  expanded: boolean
  onOpen: () => void
  events: CalendarEvent[]
  dateKey: string
  /** Текущее время, если показываем сегодняшний день. */
  nowMins: number | null
  /** Создать событие на это время. */
  onCreate: (start: number) => void
  /** Открыть событие для правки. */
  onEvent: (event: CalendarEvent) => void
}) {
  const Icon = PART_ICON[part.id]
  const hours = (part.to - part.from) / 60
  const wrap = useRef<HTMLDivElement>(null)
  const nowInside = nowMins !== null && nowMins >= part.from && nowMins < part.to

  const scrollToNow = useEffectEvent(() => {
    if (nowMins === null) return
    wrap.current?.scrollTo({ top: Math.max(0, ((nowMins - part.from) / 60) * HOUR_H - 80), behavior: 'smooth' })
  })

  // Новый день — шкала с начала, а не с позиции, на которой остался предыдущий день.
  useLayoutEffect(() => {
    if (wrap.current) wrap.current.scrollTop = 0
  }, [dateKey])

  // При раскрытии слоя с текущим временем прокручиваем шкалу к «сейчас».
  useEffect(() => {
    if (!expanded || !nowInside) return
    const id = window.setTimeout(scrollToNow, 350)
    return () => window.clearTimeout(id)
  }, [expanded, nowInside])

  /** Нажатие на пустое место шкалы — новое событие на это время (шаг 30 минут). */
  const onTimelineClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target instanceof Element && e.target.closest('[data-event]')) return
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top
    const mins = part.from + Math.floor((y / HOUR_H) * 2) * 30
    onCreate(Math.min(Math.max(mins, part.from), part.to - 30))
  }

  return (
    <m.section
      layout
      transition={spring}
      className={`${styles.part} ${styles[part.id]}`}
      style={{ zIndex: index + 1, flex: expanded ? '1 1 0%' : '0 0 auto', borderRadius: 30 }}
    >
      <m.button layout="position" type="button" className={styles.partHead} onClick={onOpen} aria-expanded={expanded}>
        <span className={styles.partTitle}>{part.title}</span>
        {!expanded && events.length > 0 && (
          <m.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={styles.partCount}>
            {pluralize(events.length, ['событие', 'события', 'событий'])}
          </m.span>
        )}
        <span className={styles.partIcon}>
          <Icon size={15} strokeWidth={2} />
        </span>
      </m.button>

      <AnimatePresence initial={false}>
        {expanded && (
          <m.div
            key="tl"
            ref={wrap}
            layout
            className={`${styles.timelineWrap} scroll-y`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.3, delay: 0.12 } }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <m.div
                key={dateKey}
                className={styles.timeline}
                style={{ height: hours * HOUR_H }}
                onClick={onTimelineClick}
                role="presentation"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={spring}
              >
                {Array.from({ length: hours }, (_, h) => (
                  <span key={h} className={`${styles.hour} tnum`} style={{ top: h * HOUR_H }}>
                    {formatMinutes(part.from + h * 60)}
                  </span>
                ))}
                {events.map((e, i) => (
                  <EventCard key={e.id} event={e} from={part.from} to={part.to} index={i} onOpen={onEvent} />
                ))}
                {nowInside && nowMins !== null && (
                  <span className={styles.now} style={{ top: ((nowMins - part.from) / 60) * HOUR_H }}>
                    <b className="tnum">{formatMinutes(nowMins)}</b>
                    <i />
                  </span>
                )}
              </m.div>
            </AnimatePresence>
            {/* Клавиатурный (и явный) способ сделать то же, что тап по пустому времени. */}
            <Pressable
              className={styles.addInPart}
              scale={0.97}
              onClick={() => onCreate(firstFreeTime(events, part.from))}
            >
              <PlusIcon size={15} /> Добавить событие · или нажмите на свободное время
            </Pressable>
          </m.div>
        )}
      </AnimatePresence>
    </m.section>
  )
}
