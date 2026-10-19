import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import styles from './Sheet.module.css'

/**
 * Светлый «лист» над градиентной нижней панелью — основа всех экранов, кроме чата.
 * Скругление снизу открывает градиент, как в референсе.
 */
export function Sheet({
  children,
  scroll = true,
  className,
  innerClassName,
}: {
  children: ReactNode
  scroll?: boolean
  className?: string
  innerClassName?: string
}) {
  return (
    <motion.div className={`${styles.sheet} ${className ?? ''}`}>
      <div className={`${styles.inner} ${scroll ? 'scroll-y' : ''} ${innerClassName ?? ''}`}>{children}</div>
    </motion.div>
  )
}
