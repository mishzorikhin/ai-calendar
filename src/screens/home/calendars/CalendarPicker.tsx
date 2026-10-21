import { m } from 'framer-motion'
import type { Ref } from 'react'
import { CheckIcon, LockIcon } from '../../../components/Icons'
import { Pressable } from '../../../components/ui'
import type { CalDavCalendar } from '../../../domain/types'
import { spring } from '../../../lib/motion'
import styles from './Calendars.module.css'

/** Выбор календарей, найденных на CalDAV-сервере. ref — для AnimatePresence. */
export function CalendarPicker({
  calendars,
  picked,
  onToggle,
  ref,
}: {
  calendars: CalDavCalendar[]
  picked: ReadonlySet<string>
  onToggle: (url: string) => void
  ref?: Ref<HTMLDivElement>
}) {
  return (
    <m.div
      ref={ref}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={spring}
    >
      <p className={styles.fieldLabel} id="caldav-found">
        Какие календари показывать
      </p>
      <div className={styles.calList} role="group" aria-labelledby="caldav-found">
        {calendars.map((cal) => {
          const on = picked.has(cal.url)
          return (
            <Pressable
              key={cal.url}
              className={styles.calItem}
              scale={0.98}
              role="checkbox"
              aria-checked={on}
              onClick={() => onToggle(cal.url)}
            >
              <i className={styles.calDot} style={{ background: cal.color || 'var(--orange)' }} />
              <span className={styles.optionText}>
                <span className={styles.optionTitle}>{cal.name}</span>
                <span className={styles.optionSub}>
                  {cal.writable ? 'Просмотр и правка' : 'Только просмотр'}
                  {!cal.writable && <LockIcon size={12} className={styles.inlineIcon} />}
                </span>
              </span>
              <span className={`${styles.check} ${on ? styles.checkOn : ''}`} aria-hidden="true">
                {on && <CheckIcon size={15} strokeWidth={2.6} />}
              </span>
            </Pressable>
          )
        })}
      </div>
    </m.div>
  )
}
