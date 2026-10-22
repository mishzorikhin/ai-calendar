import { m } from 'framer-motion'
import { useState } from 'react'
import { useWeekInsights } from '../../../api/queries'
import { BottomSheet } from '../../../components/BottomSheet'
import { BackIcon, ArrowRightIcon, CloseIcon } from '../../../components/Icons'
import { CircleButton, Pressable } from '../../../components/ui'
import { SHORT_WEEKDAYS } from '../../../domain/profile'
import type { WeekInsights } from '../../../domain/types'
import { BADGE_OPTIONS } from '../../../lib/badges'
import { MONTHS_GENITIVE, addDays, fromISODate, startOfWeek, toISODate } from '../../../lib/dates'
import { useNow } from '../../../lib/hooks'
import { spring } from '../../../lib/motion'
import { plural, pluralize } from '../../../lib/plural'
import styles from './Week.module.css'

/** «2 ч 30 мин», «45 мин», «0». */
export function hoursText(minutes: number): string {
  if (minutes <= 0) return '0'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return [h && `${h} ч`, m && `${m} мин`].filter(Boolean).join(' ')
}

function rangeLabel(start: string): string {
  const a = fromISODate(start)
  const b = addDays(a, 6)
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${MONTHS_GENITIVE[b.getMonth()]}`
    : `${a.getDate()} ${MONTHS_GENITIVE[a.getMonth()]} – ${b.getDate()} ${MONTHS_GENITIVE[b.getMonth()]}`
}

/** Сравнение с обычной неделей — словами. */
function compareText(r: WeekInsights): string {
  if (r.average === 0) return r.minutes ? 'раньше встреч не было — не с чем сравнить' : 'неделя свободна'
  const diff = r.minutes - r.average
  if (Math.abs(diff) < 60) return 'примерно как обычно'
  return diff > 0 ? `на ${hoursText(diff)} больше обычного` : `на ${hoursText(-diff)} меньше обычного`
}

/** Обзор недели: сколько встреч по дням и типам, время для фокуса, закрытые задачи. */
export function WeekSheet({ onClose, onDay }: { onClose: () => void; onDay: (date: Date) => void }) {
  const today = toISODate(useNow())
  const [start, setStart] = useState(() => startOfWeek(fromISODate(today)))
  const { data: r, isError } = useWeekInsights(start)
  const max = Math.max(60, ...(r?.days.map((d) => d.minutes) ?? []))
  const types = r
    ? BADGE_OPTIONS.map((b) => ({ ...b, minutes: r.byBadge[b.id] ?? 0 }))
        .filter((t) => t.minutes > 0)
        .sort((a, b) => b.minutes - a.minutes)
    : []
  const topType = types[0]?.minutes ?? 1

  return (
    <BottomSheet label="Неделя" onClose={onClose}>
      <div className={styles.head}>
        <div>
          <h2>Неделя</h2>
          <p className="caption">{rangeLabel(toISODate(start))}</p>
        </div>
        <div className={styles.nav}>
          <CircleButton
            tone="gray"
            size={44}
            onClick={() => setStart((s) => addDays(s, -7))}
            aria-label="Прошлая неделя"
          >
            <BackIcon size={18} />
          </CircleButton>
          <CircleButton
            tone="gray"
            size={44}
            onClick={() => setStart((s) => addDays(s, 7))}
            aria-label="Следующая неделя"
          >
            <ArrowRightIcon size={18} />
          </CircleButton>
          <CircleButton tone="gray" size={44} onClick={onClose} aria-label="Закрыть">
            <CloseIcon size={18} />
          </CircleButton>
        </div>
      </div>

      {isError && <p className={styles.error}>Не удалось посчитать неделю</p>}
      {r && (
        <>
          <p className={styles.hero}>
            <b className="tnum">{hoursText(r.minutes)}</b> встреч
          </p>
          <p className={styles.compare}>{compareText(r)}</p>

          <div className={styles.chart} role="list" aria-label="Встречи по дням">
            {r.days.map((d) => {
              const date = fromISODate(d.date)
              const busiest = d.date === r.busiest
              return (
                <Pressable
                  key={d.date}
                  role="listitem"
                  className={styles.col}
                  onClick={() => onDay(date)}
                  aria-label={`${SHORT_WEEKDAYS[date.getDay()]}, ${date.getDate()}: ${hoursText(d.minutes)}, ${pluralize(d.events, ['событие', 'события', 'событий'])}`}
                >
                  <span className={`${styles.value} tnum`}>{busiest ? hoursText(d.minutes) : ''}</span>
                  <span className={styles.track}>
                    <m.span
                      className={`${styles.bar} ${busiest ? styles.barTop : ''}`}
                      initial={{ height: 0 }}
                      animate={{ height: `${(d.minutes / max) * 100}%` }}
                      transition={spring}
                    />
                  </span>
                  <span className={`${styles.day} ${d.date === today ? styles.today : ''}`}>
                    {SHORT_WEEKDAYS[date.getDay()]}
                  </span>
                </Pressable>
              )
            })}
          </div>

          <div className={styles.tiles}>
            <div className={styles.tile}>
              <b className="tnum">{hoursText(r.focus)}</b>
              <span>для фокуса — окна от 1,5 ч в рабочее время</span>
            </div>
            <div className={styles.tile}>
              <b className="tnum">{r.done}</b>
              <span>{plural(r.done, ['задача закрыта', 'задачи закрыто', 'задач закрыто'])} за неделю</span>
            </div>
          </div>

          {types.length > 0 && (
            <>
              <p className={styles.label}>По типам</p>
              <ul className={styles.types}>
                {types.map((t) => (
                  <li key={t.id} className={styles.type}>
                    <span className={styles.typeName}>{t.label}</span>
                    <span className={styles.typeTrack}>
                      <span className={styles.typeBar} style={{ width: `${(t.minutes / topType) * 100}%` }} />
                    </span>
                    <span className={`${styles.typeValue} tnum`}>{hoursText(t.minutes)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </BottomSheet>
  )
}
