import { motion } from 'framer-motion'
import { useState } from 'react'
import { BriefcaseIcon, CapIcon, DumbbellIcon } from '../../components/Icons'
import { Pressable } from '../../components/ui'
import { spring } from '../../lib/motion'
import styles from './Home.module.css'

const CATEGORIES = [
  { id: 'study', icon: CapIcon, label: 'Учёба' },
  { id: 'sport', icon: DumbbellIcon, label: 'Спорт' },
  { id: 'work', icon: BriefcaseIcon, label: 'Работа' },
] as const

type CategoryId = (typeof CATEGORIES)[number]['id']

/** Задача с выбором категории (сегментированный переключатель). */
export function PrepCard() {
  const [active, setActive] = useState<CategoryId>('work')
  const current = CATEGORIES.find((c) => c.id === active)
  return (
    <div className={styles.prep}>
      <div className={styles.cardText}>
        <span className={styles.cardTitle}>Подготовка к встрече</span>
        <span className="caption">Бренд-команда · {current?.label}</span>
      </div>
      <div className={styles.segment} role="radiogroup" aria-label="Категория задачи">
        {CATEGORIES.map(({ id, icon: Icon, label }) => (
          <Pressable
            key={id}
            role="radio"
            aria-checked={active === id}
            aria-label={label}
            title={label}
            className={styles.segBtn}
            onClick={() => setActive(id)}
            scale={0.88}
          >
            {active === id && <motion.i layoutId="seg-active" className={styles.segActive} transition={spring} />}
            <Icon size={19} />
          </Pressable>
        ))}
      </div>
    </div>
  )
}
