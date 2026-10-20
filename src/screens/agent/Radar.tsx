import { motion, useReducedMotion } from 'framer-motion'
import type { Ref } from 'react'
import { StarIcon } from '../../components/Icons'
import type { Restaurant } from '../../domain/types'
import { bouncy, ease, spring } from '../../lib/motion'
import styles from './steps.module.css'

/** Радар поиска: пульсирующие круги и рейтинги найденных мест. */
export function Radar({ places, ref }: { places: readonly Restaurant[]; ref?: Ref<HTMLDivElement> }) {
  const still = useReducedMotion()
  return (
    <motion.div
      ref={ref}
      className={styles.radar}
      role="img"
      aria-label={`Найдено мест: ${places.length}`}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.2, transition: { duration: 0.4, ease } }}
      transition={spring}
    >
      <i className={styles.ringOuter} />
      <i className={styles.ringInner} />
      {!still &&
        [0, 1, 2].map((i) => (
          <motion.i
            key={i}
            className={styles.pulse}
            initial={{ scale: 0.2, opacity: 0.6 }}
            animate={{ scale: 1.15, opacity: 0 }}
            transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: 'easeOut' }}
          />
        ))}
      {!still && (
        <motion.i
          className={styles.sweep}
          animate={{ rotate: 360 }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'linear' }}
        />
      )}
      <span className={styles.me} />
      {places.map((r, i) => (
        <motion.span
          key={r.id}
          className={`${styles.rating} tnum`}
          style={{ left: `${50 + r.radar[0] * 42}%`, top: `${50 + r.radar[1] * 42}%` }}
          initial={{ opacity: 0, scale: 0.3 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...bouncy, delay: 0.3 + i * 0.25 }}
        >
          {r.rating.toFixed(1)}
          <StarIcon size={15} />
        </motion.span>
      ))}
    </motion.div>
  )
}
