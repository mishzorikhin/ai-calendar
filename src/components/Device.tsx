import type { ReactNode } from 'react'
import styles from './Device.module.css'

/**
 * Оболочка приложения: занимает всё окно на любом устройстве.
 */
export function Device({ children }: { children: ReactNode }) {
  return (
    <div className={styles.device}>
      <div className={styles.app} data-app-root>
        {children}
      </div>
      {/* Сюда портируются модальные шторки, чтобы фон можно было сделать inert. */}
      <div id="modal-root" className={styles.modalRoot} />
    </div>
  )
}
