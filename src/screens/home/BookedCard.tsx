import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRightIcon } from '../../components/Icons'
import { PersonAvatar, Pressable, SmartImage } from '../../components/ui'
import type { Booking } from '../../domain/types'
import { formatMinutes, relativeDayLabel } from '../../lib/dates'
import { spring } from '../../lib/motion'
import { FRIEND } from '../../mocks/people'
import styles from './Home.module.css'

/** Раздел «Скоро»: бронь, сделанная ассистентом. */
export function BookedCard({ booking, onOpen }: { booking: Booking | null; onOpen: (d: Date) => void }) {
  return (
    <AnimatePresence initial={false}>
      {booking && (
        <motion.div
          key="booked"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ ...spring, delay: 0.3 }}
          className={styles.bookedWrap}
        >
          <p className={styles.label}>Скоро</p>
          <Pressable className={styles.booked} scale={0.98} onClick={() => onOpen(booking.date)}>
            <SmartImage src={booking.restaurant.photo} art={booking.restaurant.art} className={styles.bookedThumb} />
            <span className={styles.bookedText}>
              <span className={styles.bookedTitle}>Завтрак · {booking.restaurant.name}</span>
              <span className="caption tnum">
                {relativeDayLabel(booking.date)}, {formatMinutes(booking.slot.start)} · бронь {booking.code}
              </span>
              {booking.invite && (
                <span className={styles.invite}>
                  <PersonAvatar person={FRIEND} size={16} ring={false} />
                  {FRIEND.name} приглашён · ждём ответа
                </span>
              )}
            </span>
            <ArrowRightIcon size={18} className={styles.bookedArrow} />
            <motion.i
              className={styles.bookedGlow}
              initial={{ opacity: 0.9 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 2.4, delay: 0.8 }}
            />
          </Pressable>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
