import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { ease, spring } from '../../lib/motion'
import type { StepId } from './useAgentFlow'
import styles from './Agent.module.css'

type StackStep = Exclude<StepId, 'request'>

const STEPS: readonly { id: StackStep; label: string }[] = [
  { id: 'timing', label: 'Время' },
  { id: 'finding', label: 'Поиск ресторана' },
  { id: 'booking', label: 'Бронирование' },
]

/**
 * Стопка шагов: пройденные — вкладки сверху (по ним можно вернуться),
 * текущий — раскрытая карточка, следующие — вкладки снизу.
 */
export function StepStack({
  active,
  onReturn,
  children,
}: {
  active: StackStep
  /** Вернуться к пройденному шагу. */
  onReturn: (step: Exclude<StackStep, 'booking'>) => void
  /** Содержимое активного шага. */
  children: ReactNode
}) {
  const activeIdx = STEPS.findIndex((s) => s.id === active)
  return (
    <motion.div className={styles.stack}>
      {STEPS.map((s, i) => {
        const state = i < activeIdx ? 'before' : i === activeIdx ? 'active' : 'after'
        const z = state === 'active' ? 10 : state === 'before' ? i + 1 : 10 - (i - activeIdx)
        return (
          <motion.section
            key={s.id}
            layout
            initial={{ opacity: 0, y: 80 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: active === 'timing' && state !== 'before' ? i * 0.05 : 0 }}
            className={`${styles.card} ${styles[state]}`}
            style={{ zIndex: z, borderRadius: 30 }}
            aria-current={state === 'active' ? 'step' : undefined}
          >
            {state === 'active' ? (
              <motion.div
                key={`content-${s.id}`}
                className={`${styles.content} scroll-y`}
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.3, delay: 0.1, ease } }}
              >
                {children}
              </motion.div>
            ) : state === 'before' && s.id !== 'booking' ? (
              <motion.button
                type="button"
                layout="position"
                className={styles.tab}
                onClick={() => onReturn(s.id === 'timing' ? 'timing' : 'finding')}
                aria-label={`Вернуться к шагу «${s.label}»`}
              >
                {s.label}
              </motion.button>
            ) : (
              <motion.span layout="position" className={`${styles.tab} ${styles.tabNext}`}>
                {s.label}
              </motion.span>
            )}
          </motion.section>
        )
      })}
    </motion.div>
  )
}
