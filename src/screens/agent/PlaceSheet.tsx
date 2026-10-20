import { motion } from 'framer-motion'
import { useRef, type ReactNode } from 'react'
import { useReviews } from '../../api/queries'
import { BottomSheet } from '../../components/BottomSheet'
import { ClockIcon, CloseIcon, PinIcon, StarIcon } from '../../components/Icons'
import { Avatar, CircleButton, Pill, SmartImage } from '../../components/ui'
import type { Restaurant } from '../../domain/types'
import { formatMinutes } from '../../lib/dates'
import { useTimeout } from '../../lib/hooks'
import { spring } from '../../lib/motion'
import styles from './PlaceSheet.module.css'

/** Шторка с подробностями о месте и отзывами. */
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
  const reviews = useRef<HTMLDivElement>(null)
  const { data: list = [] } = useReviews(place.id)

  // Открыли по «Отзывы» — после анимации появления докручиваем до них.
  useTimeout(
    () => reviews.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    focus === 'reviews' ? 350 : null,
  )

  return (
    <BottomSheet
      label={place.name}
      onClose={onClose}
      padded={false}
      maxHeight="86%"
      handleTone="light"
      footer={
        onBook && (
          <Pill tone="dark" className={styles.book} onClick={onBook}>
            Забронировать
          </Pill>
        )
      }
    >
      <SmartImage key={place.photo} src={place.photo} art={place.art} className={styles.hero}>
        <div className={styles.heroShade} />
        <div className={styles.heroText}>
          <span>{place.cuisine}</span>
          <strong>{place.name}</strong>
        </div>
        <CircleButton tone="glass" size={40} className={styles.close} onClick={onClose} aria-label="Закрыть">
          <CloseIcon size={18} />
        </CircleButton>
      </SmartImage>

      <div className={styles.facts}>
        <Fact
          icon={<StarIcon size={16} className={styles.star} />}
          title={place.rating.toFixed(1)}
          sub="1 240 оценок"
        />
        <Fact icon={<PinIcon size={16} />} title={place.distance} sub={`${place.walkMinutes} мин пешком`} />
        <Fact
          icon={<ClockIcon size={16} />}
          title={`до ${formatMinutes(place.closesAt)}`}
          sub={`с ${formatMinutes(place.opensAt)} · чек ${place.price}`}
        />
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
      {list.map((r, i) => (
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
              <span aria-label={`Оценка ${r.rating} из 5`}>
                {Array.from({ length: 5 }, (_, s) => (
                  <StarIcon key={s} size={12} className={s < r.rating ? styles.star : styles.starOff} />
                ))}
              </span>
            </div>
            <p>{r.text}</p>
          </div>
        </motion.div>
      ))}
    </BottomSheet>
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
