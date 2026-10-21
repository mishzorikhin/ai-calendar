import { m } from 'framer-motion'
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { softSpring } from '../lib/motion'
import { useSheetDrag } from './useSheetDrag'
import styles from './BottomSheet.module.css'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Сколько шторок сейчас открыто — фон делаем inert, пока открыта хотя бы одна.
let openCount = 0

function setAppInert(inert: boolean) {
  const app = document.querySelector<HTMLElement>('[data-app-root]')
  if (app) app.inert = inert
}

/**
 * Модальная шторка снизу: затемнённый фон, свайп вниз за любое место (см. useSheetDrag), Escape,
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
  const panel = useRef<HTMLDivElement>(null)
  const { y, dim } = useSheetDrag(panel, onClose)

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

  const content = (
    <m.div className={styles.root} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <m.div className={styles.backdrop} style={{ opacity: dim }} onClick={onClose} aria-hidden="true" />
      <m.div
        ref={panel}
        className={styles.sheet}
        style={{ maxHeight, y }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%', transition: { duration: 0.28 } }}
        transition={softSpring}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className={styles.handleZone} aria-hidden="true">
          <i className={handleTone === 'light' ? styles.handleLight : undefined} />
        </div>
        <div className={`${styles.body} ${padded ? styles.padded : ''} scroll-y`}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </m.div>
    </m.div>
  )

  const root = document.getElementById('modal-root')
  return root ? createPortal(content, root) : content
}
