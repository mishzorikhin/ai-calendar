import { motion } from 'framer-motion'
import { useLayoutEffect, useRef, useState, type Ref } from 'react'
import { HeartIcon, StarIcon } from '../../components/Icons'
import { Pill, Pressable, SmartImage } from '../../components/ui'
import { hoursLabel, isOpenAt } from '../../domain/restaurants'
import type { Restaurant } from '../../domain/types'
import { formatMinutes } from '../../lib/dates'
import { spring } from '../../lib/motion'
import styles from './steps.module.css'

/** Карусель мест (нативная прокрутка со snap): фото, рейтинг, пешком, цена, открыто ли в нужное время. */
export function PlaceCarousel({
  places,
  time,
  index,
  onIndex,
  onBook,
  onDetails,
  ref,
}: {
  places: readonly Restaurant[]
  time: number
  index: number
  onIndex: (i: number) => void
  onBook: (r: Restaurant) => void
  onDetails: () => void
  ref?: Ref<HTMLDivElement>
}) {
  const track = useRef<HTMLDivElement>(null)
  const [liked, setLiked] = useState<Readonly<Record<string, boolean>>>({})
  const [initialIndex] = useState(index)

  // Открываем карусель на текущей карточке до первой отрисовки, без анимации прокрутки.
  useLayoutEffect(() => {
    const el = track.current
    if (el) el.scrollLeft = initialIndex * el.clientWidth
  }, [initialIndex])

  const onScroll = () => {
    const el = track.current
    if (!el) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    if (i !== index) onIndex(i)
  }

  const scrollTo = (i: number) => track.current?.scrollTo({ left: i * track.current.clientWidth, behavior: 'smooth' })

  return (
    <motion.div
      ref={ref}
      className={styles.carousel}
      initial={{ opacity: 0, y: 30, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring}
    >
      <div ref={track} className={styles.track} onScroll={onScroll} role="list" aria-label="Найденные места">
        {places.map((r, i) => {
          const open = isOpenAt(r, time)
          const isLiked = liked[r.id] ?? false
          return (
            <div key={r.id} className={styles.slide} role="listitem" aria-label={`${i + 1} из ${places.length}`}>
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
                    onClick={() => setLiked((l) => ({ ...l, [r.id]: !isLiked }))}
                    aria-label={`${r.name} в избранное`}
                    aria-pressed={isLiked}
                  >
                    <motion.span animate={{ scale: isLiked ? [1, 1.35, 1] : 1 }} transition={{ duration: 0.35 }}>
                      <HeartIcon size={20} filled={isLiked} />
                    </motion.span>
                  </Pressable>
                  <div className={styles.placeMeta}>
                    <StarIcon size={14} className={styles.goldStar} />
                    <b className="tnum">{r.rating.toFixed(1)}</b>
                    <span className="tnum">
                      · пешком {r.walkMinutes} мин · {r.price}
                    </span>
                  </div>
                  <p className={`${styles.openState} ${open ? styles.isOpen : styles.isClosed}`}>
                    <i />
                    {open
                      ? `Открыто в ${formatMinutes(time)} · ${hoursLabel(r)}`
                      : `Закрыто в ${formatMinutes(time)} · откроется в ${formatMinutes(r.opensAt)}`}
                  </p>
                  <p className={styles.placeDesc}>{r.description}</p>
                  <div className={styles.placeBtns}>
                    <Pill
                      tone="white"
                      onClick={() => onBook(r)}
                      disabled={!open}
                      className={open ? undefined : styles.disabled}
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
          <button
            key={r.id}
            type="button"
            onClick={() => scrollTo(i)}
            aria-label={`Показать ${r.name}`}
            aria-current={i === index}
          >
            <motion.i animate={{ width: i === index ? 18 : 6, opacity: i === index ? 1 : 0.35 }} transition={spring} />
          </button>
        ))}
      </div>
    </motion.div>
  )
}
