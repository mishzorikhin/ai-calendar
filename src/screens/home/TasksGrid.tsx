import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useState } from 'react'
import { CheckIcon, StarIcon } from '../../components/Icons'
import { Pill, Pressable } from '../../components/ui'
import { MONTHS_GENITIVE } from '../../lib/dates'
import { useTimeout } from '../../lib/hooks'
import { bouncy, itemVariants, spring } from '../../lib/motion'
import styles from './Home.module.css'

/** Задачи и цели: поездка (отметка) и оценка ужина. */
export function TasksGrid() {
  const [rateOpen, setRateOpen] = useState(false)
  const span = rateOpen ? styles.span : undefined
  return (
    <div className={styles.grid}>
      <motion.div layout transition={spring} variants={itemVariants} className={span}>
        <TripCard />
      </motion.div>
      <motion.div layout transition={spring} variants={itemVariants} className={span}>
        <DinnerCard open={rateOpen} onOpenChange={setRateOpen} />
      </motion.div>
    </div>
  )
}

function TripCard() {
  const [done, setDone] = useState(false)
  const still = useReducedMotion()
  return (
    <div className={`${styles.trip} ${done ? styles.tripDone : ''}`}>
      <motion.i
        className={styles.blobA}
        animate={still ? undefined : { y: [0, -6, 0], rotate: [0, 4, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.i
        className={styles.blobB}
        animate={still ? undefined : { y: [0, 5, 0], x: [0, -4, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className={styles.cardText}>
        <span className={styles.cardTitle}>Поездка во Францию</span>
        <span className="caption">Цель · к 26 {MONTHS_GENITIVE[6]}</span>
      </div>
      <Pressable
        className={`${styles.check} ${done ? styles.checkOn : ''}`}
        onClick={() => setDone((d) => !d)}
        aria-label={done ? 'Снять отметку' : 'Отметить выполненной'}
        aria-pressed={done}
      >
        <motion.span animate={{ scale: done ? [0.6, 1.2, 1] : 1 }} transition={bouncy}>
          <CheckIcon size={18} strokeWidth={2.2} />
        </motion.span>
      </Pressable>
    </div>
  )
}

const RATE_CLOSE_DELAY = 500

function DinnerCard({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [rating, setRating] = useState(0)
  // Каждый новый выбор перезапускает таймер закрытия: быстрые нажатия не закрывают панель раньше времени.
  const [ratedAt, setRatedAt] = useState(0)
  useTimeout(() => onOpenChange(false), open && ratedAt ? RATE_CLOSE_DELAY : null, ratedAt)

  return (
    <div className={`${styles.dinner} ${open ? styles.dinnerOpen : ''}`}>
      <motion.div layout="position" className={styles.cardText}>
        <span className={styles.cardTitle}>{rating ? 'Ужин оценён' : 'Оцените ужин'}</span>
        <span className="caption">Water Bar · вчера</span>
      </motion.div>
      {!open && (
        <div className={styles.glass} aria-hidden="true">
          <i />
        </div>
      )}
      <div className={styles.rateRow}>
        <AnimatePresence mode="popLayout" initial={false}>
          {open ? (
            <motion.div
              key="stars"
              className={styles.stars}
              role="radiogroup"
              aria-label="Оценка ужина"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={spring}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable
                  key={n}
                  scale={0.8}
                  className={styles.star}
                  role="radio"
                  aria-checked={n === rating}
                  aria-label={`${n} из 5`}
                  onClick={() => {
                    setRating(n)
                    setRatedAt(Date.now())
                  }}
                >
                  <motion.span
                    animate={{ scale: n <= rating ? [1, 1.3, 1] : 1 }}
                    className={n <= rating ? styles.starOn : styles.starOff}
                    transition={{ duration: 0.3, delay: n * 0.03 }}
                  >
                    <StarIcon size={28} />
                  </motion.span>
                </Pressable>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="btn"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
            >
              <Pill
                small
                tone="white"
                onClick={() => {
                  setRatedAt(0)
                  onOpenChange(true)
                }}
              >
                {rating ? (
                  <>
                    <StarIcon size={14} className={styles.starOn} /> {rating}.0
                  </>
                ) : (
                  'Оценить'
                )}
              </Pill>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
