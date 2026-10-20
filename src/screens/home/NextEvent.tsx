import { useComposer } from '../../app/composer'
import { Pill, Pressable } from '../../components/ui'
import type { DatedEvent } from '../../domain/types'
import { formatMinutes, isSameDay } from '../../lib/dates'
import styles from './Home.module.css'

/** Ближайшее событие: тап по тексту — правка, «Открыть день» — экран дня. */
export function NextEvent({ event, onOpen }: { event: DatedEvent; onOpen: () => void }) {
  const composer = useComposer()
  const isToday = isSameDay(event.date, new Date())

  return (
    <div className={styles.meeting}>
      <Pressable
        className={styles.meetingText}
        scale={0.98}
        onClick={() => composer.open({ event })}
        aria-label={`Изменить: ${event.title}`}
      >
        <span className="caption tnum">
          {isToday ? 'Далее' : 'Завтра'} · {formatMinutes(event.start)}–{formatMinutes(event.end)}
        </span>
        <span className={`title ${styles.meetingTitle}`}>{event.title}</span>
        {event.subtitle && <span className={styles.meetingSub}>{event.subtitle}</span>}
      </Pressable>
      <div className={styles.meetingActions}>
        <Pill tone="ghost" small onClick={() => composer.open({ event })}>
          Изменить
        </Pill>
        <Pill tone="ghost" small onClick={onOpen}>
          Открыть день
        </Pill>
      </div>
    </div>
  )
}
