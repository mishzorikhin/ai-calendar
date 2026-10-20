import { AnimatePresence } from 'framer-motion'
import type { Restaurant } from '../../domain/types'
import { PlaceCarousel } from './PlaceCarousel'
import { Radar } from './Radar'
import styles from './steps.module.css'

/** Шаг 2: поиск мест рядом — сначала радар, затем карусель карточек. */
export function FindingStep({
  phase,
  places,
  time,
  radiusKm,
  index,
  onIndex,
  onBook,
  onDetails,
}: {
  phase: 'radar' | 'results'
  /** Места, отсортированные: сначала открытые в нужное время. */
  places: readonly Restaurant[]
  time: number
  radiusKm: number
  index: number
  onIndex: (i: number) => void
  onBook: (r: Restaurant) => void
  onDetails: () => void
}) {
  return (
    <div className={`${styles.step} ${styles.stepFill}`}>
      <p className={styles.kicker}>Поиск ресторана · до {radiusKm} км</p>
      <h2 className={styles.heading}>Рядом с вами</h2>
      <div className={styles.findArea} aria-live="polite">
        <AnimatePresence mode="popLayout" initial={false}>
          {phase === 'radar' ? (
            <Radar key="radar" places={places} />
          ) : (
            <PlaceCarousel
              key="carousel"
              places={places}
              time={time}
              index={index}
              onIndex={onIndex}
              onBook={onBook}
              onDetails={onDetails}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
