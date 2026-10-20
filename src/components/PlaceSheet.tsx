import { motion, useDragControls, type PanInfo } from 'framer-motion'
import { useEffect, useRef, type ReactNode } from 'react'
import { REVIEWS, type Restaurant } from '../data'
import { softSpring, spring } from '../lib/motion'
import { ClockIcon, CloseIcon, PinIcon, StarIcon } from './Icons'
import { Avatar, CircleButton, Pill, SmartImage } from './ui'
import styles from './PlaceSheet.module.css'

/** Шторка с подробностями о месте и отзывами. Закрывается свайпом вниз. */
export function PlaceSheet({
  place,
  focus,
  onClose,
  onBook,
}: {
  place: Restaurant
  focus: 'details' | 'reviews'
  onClose: () => void
  onBook?: () => void
}) {
  const drag = useDragControls()
  const body = useRef<HTMLDivElement>(null)
  const reviews = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (focus === 'reviews' && body.current && reviews.current) {
      const top = reviews.current.offsetTop - 12
      window.setTimeout(() => body.current?.scrollTo({ top, behavior: 'smooth' }), 350)
    }
  }, [focus])

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 600) onClose()
  }

  return (
    <motion.div className={styles.root} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className={styles.backdrop} onClick={onClose} />
      <motion.div
        className={styles.sheet}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%', transition: { duration: 0.3 } }}
        transition={softSpring}
        drag="y"
        dragControls={drag}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.05, bottom: 0.8 }}
        onDragEnd={onDragEnd}
        role="dialog"
        aria-label={place.name}
      >
        <div className={styles.handleZone} onPointerDown={(e) => drag.start(e)}>
          <i className={styles.handle} />
        </div>
        <div ref={body} className={`${styles.body} scroll-y`}>
          <SmartImage src={place.photo} art={place.art} className={styles.hero}>
            <div className={styles.heroShade} />
            <div className={styles.heroText}>
              <span>{place.cuisine}</span>
              <strong>{place.name}</strong>
            </div>
            <CircleButton tone="glass" size={38} className={styles.close} onClick={onClose} aria-label="Закрыть">
              <CloseIcon size={18} />
            </CircleButton>
          </SmartImage>

          <div className={styles.facts}>
            <Fact
              icon={<StarIcon size={16} style={{ color: '#f5b83d' }} />}
              title={place.rating.toFixed(1)}
              sub="1 240 оценок"
            />
            <Fact icon={<PinIcon size={16} />} title={place.distance} sub={`${place.minutes} мин пешком`} />
            <Fact icon={<ClockIcon size={16} />} title={place.hours} sub={`Средний чек ${place.price}`} />
          </div>

          <p className={styles.desc}>{place.description}</p>
          <p className={styles.address}>{place.address}</p>

          <div className={styles.tags}>
            {place.tags.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>

          <div ref={reviews} className={styles.reviewsHead}>
            <h3>Отзывы</h3>
            <span className="caption">Сначала полезные</span>
          </div>
          {REVIEWS.map((r, i) => (
            <motion.div
              key={r.name}
              className={styles.review}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.25 + i * 0.07 }}
            >
              <Avatar initials={r.initials} color={r.color} size={36} ring={false} />
              <div>
                <div className={styles.reviewTop}>
                  <b>{r.name}</b>
                  <span>
                    {Array.from({ length: 5 }, (_, s) => (
                      <StarIcon key={s} size={12} style={{ color: s < r.rating ? '#f5b83d' : '#e0e0e6' }} />
                    ))}
                  </span>
                </div>
                <p>{r.text}</p>
              </div>
            </motion.div>
          ))}
        </div>
        {onBook && (
          <div className={styles.footer}>
            <Pill tone="dark" className={styles.book} onClick={onBook}>
              Забронировать
            </Pill>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

function Fact({ icon, title, sub }: { icon: ReactNode; title: string; sub: string }) {
  return (
    <div className={styles.fact}>
      <span className={styles.factTitle}>
        {icon}
        <b className="tnum">{title}</b>
      </span>
      <span className="caption">{sub}</span>
    </div>
  )
}
