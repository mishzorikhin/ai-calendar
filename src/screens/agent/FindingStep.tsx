import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { HeartIcon, StarIcon } from '../../components/Icons'
import { Pill, Pressable, SmartImage } from '../../components/ui'
import { RESTAURANTS, type Restaurant } from '../../data'
import { formatMinutes } from '../../lib/dates'
import { bouncy, ease, spring } from '../../lib/motion'
import styles from './steps.module.css'

/** Открыто ли место в нужное время. */
export function isOpenAt(r: Restaurant, mins: number) {
  return r.opensAt <= mins
}

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
  places: Restaurant[]
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
      <div className={styles.findArea}>
        <AnimatePresence mode="popLayout" initial={false}>
          {phase === 'radar' ? (
            <Radar key="radar" />
          ) : (
            <Carousel
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

function Radar() {
  return (
    <motion.div
      className={styles.radar}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.25, filter: 'blur(10px)', transition: { duration: 0.45, ease } }}
      transition={spring}
    >
      <i className={styles.ringOuter} />
      <i className={styles.ringInner} />
      {[0, 1, 2].map((i) => (
        <motion.i
          key={i}
          className={styles.pulse}
          initial={{ scale: 0.2, opacity: 0.6 }}
          animate={{ scale: 1.15, opacity: 0 }}
          transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: 'easeOut' }}
        />
      ))}
      <motion.i
        className={styles.sweep}
        animate={{ rotate: 360 }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'linear' }}
      />
      <span className={styles.me} />
      {RESTAURANTS.map((r, i) => (
        <motion.span
          key={r.id}
          className={`${styles.rating} tnum`}
          style={{ left: `${50 + r.radar[0] * 42}%`, top: `${50 + r.radar[1] * 42}%` }}
          initial={{ opacity: 0, scale: 0.3, filter: 'blur(6px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          transition={{ ...bouncy, delay: 0.3 + i * 0.25 }}
        >
          {r.rating.toFixed(1)}
          <StarIcon size={15} />
        </motion.span>
      ))}
    </motion.div>
  )
}

function Carousel({
  places,
  time,
  index,
  onIndex,
  onBook,
  onDetails,
}: {
  places: Restaurant[]
  time: number
  index: number
  onIndex: (i: number) => void
  onBook: (r: Restaurant) => void
  onDetails: () => void
}) {
  const track = useRef<HTMLDivElement>(null)
  const [liked, setLiked] = useState<Record<string, boolean>>({})

  // Открываем карусель на текущей карточке без анимации прокрутки.
  useEffect(() => {
    const el = track.current
    if (el) el.scrollLeft = index * el.clientWidth
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onScroll = () => {
    const el = track.current
    if (!el) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    if (i !== index) onIndex(i)
  }

  const scrollTo = (i: number) => track.current?.scrollTo({ left: i * track.current.clientWidth, behavior: 'smooth' })

  return (
    <motion.div
      className={styles.carousel}
      initial={{ opacity: 0, y: 30, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
    >
      <div ref={track} className={styles.track} onScroll={onScroll}>
        {places.map((r, i) => {
          const open = isOpenAt(r, time)
          return (
            <div key={r.id} className={styles.slide}>
              <SmartImage src={r.photo} art={r.art} className={styles.placeCard}>
                <div className={styles.placeShade} />
                <motion.div
                  className={styles.placeName}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...spring, delay: 0.15 + i * 0.05 }}
                >
                  <span>{r.cuisine}</span>
                  <strong>{r.name}</strong>
                </motion.div>
                <div className={styles.placePanel} style={{ background: r.tint }}>
                  <Pressable
                    className={styles.heart}
                    scale={0.8}
                    onClick={() => setLiked((l) => ({ ...l, [r.id]: !l[r.id] }))}
                    aria-label="В избранное"
                    aria-pressed={!!liked[r.id]}
                  >
                    <motion.span animate={{ scale: liked[r.id] ? [1, 1.35, 1] : 1 }} transition={{ duration: 0.35 }}>
                      <HeartIcon size={20} filled={!!liked[r.id]} />
                    </motion.span>
                  </Pressable>
                  <div className={styles.placeMeta}>
                    <StarIcon size={14} style={{ color: '#f5c04a' }} />
                    <b className="tnum">{r.rating.toFixed(1)}</b>
                    <span className="tnum">
                      · пешком {r.minutes} мин · {r.price}
                    </span>
                  </div>
                  <p className={`${styles.openState} ${open ? styles.isOpen : styles.isClosed}`}>
                    <i />
                    {open
                      ? `Открыто в ${formatMinutes(time)} · ${r.hours}`
                      : `Закрыто в ${formatMinutes(time)} · откроется в ${formatMinutes(r.opensAt)}`}
                  </p>
                  <p className={styles.placeDesc}>{r.description}</p>
                  <div className={styles.placeBtns}>
                    <Pill
                      tone="white"
                      onClick={() => onBook(r)}
                      disabled={!open}
                      className={!open ? styles.disabled : undefined}
                    >
                      {open ? 'Забронировать' : 'Закрыто'}
                    </Pill>
                    <Pill tone="glass" className={styles.glassBtn} onClick={onDetails}>
                      Подробнее
                    </Pill>
                  </div>
                </div>
              </SmartImage>
            </div>
          )
        })}
      </div>
      <div className={styles.pager}>
        {places.map((r, i) => (
          <button key={r.id} type="button" onClick={() => scrollTo(i)} aria-label={`Показать ${r.name}`}>
            <motion.i animate={{ width: i === index ? 18 : 6, opacity: i === index ? 1 : 0.35 }} transition={spring} />
          </button>
        ))}
      </div>
    </motion.div>
  )
}
