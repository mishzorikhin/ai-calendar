import { motion } from 'framer-motion'
import { CardsIcon, ListIcon } from '../../components/Icons'
import { Pressable } from '../../components/ui'
import { spring } from '../../lib/motion'
import styles from './Day.module.css'

export type DayMode = 'timeline' | 'agenda'

const MODES = [
  { id: 'timeline', icon: ListIcon, label: 'Шкала времени' },
  { id: 'agenda', icon: CardsIcon, label: 'Список' },
] as const

/** Переключатель вида дня в нижней панели. */
export function ModeToggle({ mode, onChange }: { mode: DayMode; onChange: (m: DayMode) => void }) {
  return (
    <div className={styles.toggle} role="radiogroup" aria-label="Вид дня">
      {MODES.map(({ id, icon: Icon, label }) => (
        <Pressable
          key={id}
          role="radio"
          aria-checked={mode === id}
          aria-label={label}
          aria-controls="day-view"
          className={styles.toggleBtn}
          onClick={() => onChange(id)}
          scale={0.9}
        >
          {mode === id && <motion.i layoutId="mode-knob" className={styles.knob} transition={spring} />}
          <Icon size={20} />
        </Pressable>
      ))}
    </div>
  )
}
