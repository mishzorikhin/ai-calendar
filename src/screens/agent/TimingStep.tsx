import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { ClockIcon } from '../../components/Icons'
import { Pill } from '../../components/ui'
import { TIME_OPTIONS, type Slot } from '../../data'
import { formatMinutes } from '../../lib/dates'
import { ease, spring } from '../../lib/motion'
import styles from './steps.module.css'

const swap = {
  initial: { opacity: 0, y: 12, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -12, filter: 'blur(4px)' },
  transition: spring,
}

/** Шаг 1: свободное окно между делами. Рядом — другие окна и выбор своего времени. */
export function TimingStep({
  slot,
  alternatives,
  when,
  onSelect,
  onBook,
}: {
  slot: Slot
  alternatives: Slot[]
  /** «Завтра, вторник» */
  when: string
  onSelect: (start: number) => void
  onBook: () => void
}) {
  const [custom, setCustom] = useState(false)
  const busy = slot.conflicts.length > 0
  const key = `${slot.start}-${slot.end}`

  return (
    <div className={styles.step}>
      <p className={styles.kicker}>Время</p>
      <h2 className={styles.heading}>{busy ? 'Это время занято' : 'Нашёл свободное окно'}</h2>
      <p className={styles.sub}>{when} — свободны вы оба</p>

      <div className={styles.slotList}>
        <AnimatePresence mode="popLayout" initial={false}>
          {slot.before && (
            <motion.div key={`b${key}`} className={styles.slotRow} {...swap}>
              <span className="caption tnum">{formatMinutes(slot.before.at)}</span>
              <span className={styles.slotTitle}>{slot.before.title}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div layout className={`${styles.free} ${busy ? styles.freeBusy : ''}`} transition={spring}>
          <div className={`${styles.freeTimes} tnum`}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={`s${key}`} {...swap}>
                {formatMinutes(slot.start)}
              </motion.span>
            </AnimatePresence>
            <span>—</span>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={`e${key}`} {...swap}>
                {formatMinutes(slot.end)}
              </motion.span>
            </AnimatePresence>
          </div>
          <span className={styles.freeTitle}>{busy ? 'Пересечение' : 'Свободное время'}</span>
          {busy && <span className={styles.conflict}>{slot.conflicts.join(', ')}</span>}
          <motion.i
            className={styles.sun}
            initial={{ y: 70, scale: 0.7 }}
            animate={{ y: busy ? 40 : 0, scale: [1, 1.06, 1] }}
            transition={{
              y: { type: 'spring', stiffness: 120, damping: 18, delay: 0.3 },
              scale: { duration: 4, repeat: Infinity, ease: 'easeInOut' },
            }}
          />
        </motion.div>

        <AnimatePresence mode="popLayout" initial={false}>
          {slot.after && (
            <motion.div key={`a${key}`} className={styles.slotRow} {...swap}>
              <span className="caption tnum">{formatMinutes(slot.after.at)}</span>
              <span className={styles.slotTitle}>{slot.after.title}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className={styles.altBlock}>
        <p className="caption">Другие свободные окна</p>
        <div className={styles.altRow}>
          {alternatives.map((s) => (
            <Pill
              key={s.start}
              small
              tone={s.start === slot.start ? 'dark' : 'ghost'}
              aria-pressed={s.start === slot.start}
              onClick={() => {
                setCustom(false)
                onSelect(s.start)
              }}
              className="tnum"
            >
              {formatMinutes(s.start)}
            </Pill>
          ))}
          <Pill small tone={custom ? 'dark' : 'ghost'} aria-expanded={custom} onClick={() => setCustom((c) => !c)}>
            <ClockIcon size={15} /> Своё время
          </Pill>
        </div>
        <AnimatePresence initial={false}>
          {custom && (
            <motion.div
              className={`${styles.altRow} ${styles.altTimes} scroll-x`}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease }}
            >
              {TIME_OPTIONS.map((t) => (
                <Pill
                  key={t}
                  small
                  tone={t === slot.start ? 'dark' : 'ghost'}
                  aria-pressed={t === slot.start}
                  onClick={() => onSelect(t)}
                  className="tnum"
                >
                  {formatMinutes(t)}
                </Pill>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className={styles.cta}>
        <Pill tone="dark" className={styles.ctaMain} onClick={onBook}>
          {busy ? 'Всё равно выбрать это время' : `Искать места на ${formatMinutes(slot.start)}`}
        </Pill>
      </div>
    </div>
  )
}
