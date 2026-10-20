import { motion } from 'framer-motion'
import { useCalendar } from '../../app/calendar'
import { useNavigation } from '../../app/navigation'
import { DAY_PARTS } from '../../domain/calendar'
import { formatMinutes, startOfDay } from '../../lib/dates'
import { softSpring } from '../../lib/motion'
import { eventsFor } from '../../mocks/calendar'
import styles from './Chat.module.css'

const morning = DAY_PARTS[0]

/** Мини-превью утра сегодняшнего дня — день «уменьшается» до карточки при входе в чат. */
export function DayPreview() {
  const { booking, customEvents, setSelectedDate } = useCalendar()
  const { go } = useNavigation()
  const today = startOfDay(new Date())
  const items = eventsFor(today, booking, customEvents)
    .filter((e) => morning && e.start >= morning.from && e.start < morning.to)
    .slice(0, 3)

  return (
    <motion.button
      type="button"
      className={styles.preview}
      onClick={() => {
        setSelectedDate(today)
        go('day')
      }}
      initial={{ y: 180, scale: 1.5, opacity: 0 }}
      animate={{ y: 0, scale: 1, opacity: 1 }}
      transition={softSpring}
      whileTap={{ scale: 0.97 }}
      aria-label="Открыть сегодняшний день"
    >
      <span className={styles.previewHead}>
        {morning?.title} <i />
      </span>
      {items.map((e) => (
        <span key={e.id} className={styles.previewRow}>
          <span className="tnum">{formatMinutes(e.start)}</span>
          <span className={styles.previewCard}>
            {e.title}
            {e.subtitle && <small>{e.subtitle}</small>}
          </span>
        </span>
      ))}
    </motion.button>
  )
}
