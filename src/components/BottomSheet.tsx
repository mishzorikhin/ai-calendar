import { motion, useDragControls, type PanInfo } from 'framer-motion'
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { softSpring } from '../lib/motion'
import styles from './BottomSheet.module.css'

const CLOSE_OFFSET = 110
const CLOSE_VELOCITY = 600

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Сколько шторок сейчас открыто — фон делаем inert, пока открыта хотя бы одна.
let openCount = 0

function setAppInert(inert: boolean) {
  const app = document.querySelector<HTMLElement>('[data-app-root]')
  if (app) app.inert = inert
}

/**
 * Модальная шторка снизу: затемнённый фон, свайп вниз для закрытия, Escape,
 * фокус внутри шторки и возврат фокуса после закрытия. Рендерится в #modal-root.
 * Оборачивать в <AnimatePresence>, чтобы работала анимация закрытия.
 */
export function BottomSheet({
  label,
  onClose,
  children,
  footer,
  padded = true,
  maxHeight = '92%',
  handleTone = 'dark',
}: {
  label: string
  onClose: () => void
  children: ReactNode
  /** Закреплённый низ шторки (кнопки), не прокручивается вместе с содержимым. */
  footer?: ReactNode
  padded?: boolean
  maxHeight?: string
  /** Светлая «ручка» — для шторок с фото сверху. */
  handleTone?: 'dark' | 'light'
}) {
  const drag = useDragControls()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    openCount += 1
    setAppInert(true)
    panel.current?.focus({ preventScroll: true })
    return () => {
      openCount -= 1
      if (openCount === 0) setAppInert(false)
      previous?.focus?.({ preventScroll: true })
    }
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !panel.current) return
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    const first = items[0]
    const last = items.at(-1)
    if (!first || !last) return
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > CLOSE_OFFSET || info.velocity.y > CLOSE_VELOCITY) onClose()
  }

  const content = (
    <motion.div className={styles.root} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <motion.div
        ref={panel}
        className={styles.sheet}
        style={{ maxHeight }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%', transition: { duration: 0.28 } }}
        transition={softSpring}
        drag="y"
        dragControls={drag}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.05, bottom: 0.8 }}
        onDragEnd={onDragEnd}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className={styles.handleZone} onPointerDown={(e) => drag.start(e)} aria-hidden="true">
          <i className={handleTone === 'light' ? styles.handleLight : undefined} />
        </div>
        <div className={`${styles.body} ${padded ? styles.padded : ''} scroll-y`}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </motion.div>
    </motion.div>
  )

  const root = document.getElementById('modal-root')
  return root ? createPortal(content, root) : content
}
