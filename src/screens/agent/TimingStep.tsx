import { AnimatePresence, motion } from 'framer-motion'
import { ClockIcon } from '../../components/Icons'
import { CircleButton, Pill } from '../../components/ui'
import type { Slot } from '../../data'
import { WEEKDAYS, addDays, formatMinutes } from '../../lib/dates'
import { spring } from '../../lib/motion'
import styles from './steps.module.css'

const swap = {
  initial: { opacity: 0, y: 12, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -12, filter: 'blur(4px)' },
  transition: spring,
}

/** Шаг 1: ассистент нашёл свободное окно между делами. */
export function TimingStep({
  slot,
  slotIdx,
  onNextSlot,
  onBook,
}: {
  slot: Slot
  slotIdx: number
  onNextSlot: () => void
  onBook: () => void
}) {
  const tomorrow = addDays(new Date(), 1)
  return (
    <div className={styles.step}>
      <p className={styles.kicker}>Время</p>
      <h2 className={styles.heading}>Нашёл свободное окно</h2>
      <p className={styles.sub}>Завтра, {WEEKDAYS[tomorrow.getDay()].toLowerCase()} — свободны вы оба</p>

      <div className={styles.slotList}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={`b${slotIdx}`} className={styles.slotRow} {...swap}>
            <span className="caption tnum">{formatMinutes(slot.beforeAt)}</span>
            <span className={styles.slotTitle}>{slot.before}</span>
          </motion.div>
        </AnimatePresence>

        <motion.div layout className={styles.free} transition={spring}>
          <div className={`${styles.freeTimes} tnum`}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={`s${slotIdx}`} {...swap}>
                {formatMinutes(slot.start)}
              </motion.span>
            </AnimatePresence>
            <span>—</span>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={`e${slotIdx}`} {...swap}>
                {formatMinutes(slot.end)}
              </motion.span>
            </AnimatePresence>
          </div>
          <span className={styles.freeTitle}>Свободное время</span>
          <motion.i
            className={styles.sun}
            initial={{ y: 70, scale: 0.7 }}
            animate={{ y: 0, scale: [1, 1.06, 1] }}
            transition={{
              y: { type: 'spring', stiffness: 120, damping: 18, delay: 0.35 },
              scale: { duration: 4, repeat: Infinity, ease: 'easeInOut' },
            }}
          />
        </motion.div>

        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div key={`a${slotIdx}`} className={styles.slotRow} {...swap}>
            <span className="caption tnum">{formatMinutes(slot.afterAt)}</span>
            <span className={styles.slotTitle}>{slot.after}</span>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className={styles.cta}>
        <Pill tone="dark" className={styles.ctaMain} onClick={onBook}>
          Забронировать на это время
        </Pill>
        <CircleButton tone="gray" size={54} onClick={onNextSlot} aria-label="Другое время">
          <ClockIcon size={22} />
        </CircleButton>
      </div>
    </div>
  )
}
