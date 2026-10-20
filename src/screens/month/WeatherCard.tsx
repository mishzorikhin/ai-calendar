import { ArrowUpRightIcon } from '../../components/Icons'
import { Pressable } from '../../components/ui'
import { MONTHS_GENITIVE } from '../../lib/dates'
import { WeatherArt } from './WeatherArt'
import styles from './Month.module.css'

/** Погода на сегодня; нажатие открывает сегодняшний день. */
export function WeatherCard({ today, onOpen }: { today: Date; onOpen: () => void }) {
  return (
    <Pressable className={styles.weather} scale={0.98} onClick={onOpen} aria-label="Сегодня, 14 °C. Открыть день">
      <div className={styles.weatherArt}>
        <WeatherArt />
      </div>
      <span className={styles.weatherText}>
        <span className={styles.weatherLabel}>Сегодня</span>
        <span className={`${styles.temp} tnum`}>14°C</span>
        <span className={styles.weatherLabel}>
          {today.getDate()} {MONTHS_GENITIVE[today.getMonth()]}
        </span>
      </span>
      <span className={styles.weatherBtn}>
        <ArrowUpRightIcon size={18} />
      </span>
    </Pressable>
  )
}
