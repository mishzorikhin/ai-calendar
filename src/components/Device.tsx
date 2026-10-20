import { useEffect, useState, type ReactNode } from 'react'
import { pad2 } from '../lib/dates'
import styles from './Device.module.css'

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000)
    return () => window.clearInterval(id)
  }, [])
  return `${now.getHours()}:${pad2(now.getMinutes())}`
}

/**
 * На телефоне приложение занимает весь экран.
 * На широком экране оно показывается внутри макета iPhone на «сцене», как в видео-референсе.
 */
export function Device({ children }: { children: ReactNode }) {
  const time = useClock()
  return (
    <div className={styles.stage}>
      <div className={styles.scene} aria-hidden="true">
        <i className={styles.slabA} />
        <i className={styles.slabB} />
        <i className={styles.slabC} />
        <i className={styles.glass} />
      </div>
      <div className={styles.device}>
        <div className={styles.screen}>
          <div className={styles.app} data-app-root>
            {children}
          </div>
          {/* Сюда портируются модальные шторки, чтобы фон можно было сделать inert. */}
          <div id="modal-root" className={styles.modalRoot} />
        </div>
        <div className={styles.statusBar} aria-hidden="true">
          <span className="tnum">{time}</span>
          <span className={styles.statusIcons}>
            <svg width="18" height="12" viewBox="0 0 18 12">
              <rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor" />
              <rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor" />
              <rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor" />
              <rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor" />
            </svg>
            <svg width="16" height="12" viewBox="0 0 16 12">
              <path
                d="M8 2.2c2.3 0 4.4.9 6 2.4l1.1-1.2A10.2 10.2 0 0 0 8 .6C5.3.6 2.8 1.6.9 3.4L2 4.6a8.6 8.6 0 0 1 6-2.4Zm0 3.3c1.4 0 2.7.5 3.7 1.4l1.1-1.2A7 7 0 0 0 8 3.9a7 7 0 0 0-4.8 1.8l1.1 1.2c1-.9 2.3-1.4 3.7-1.4Zm0 3.3c.6 0 1.1.2 1.5.6L8 11 6.5 9.4c.4-.4.9-.6 1.5-.6Z"
                fill="currentColor"
              />
            </svg>
            <span className={styles.battery}>
              <i />
            </span>
          </span>
        </div>
        <div className={styles.island} aria-hidden="true">
          <i />
        </div>
        <div className={styles.homeIndicator} aria-hidden="true" />
      </div>
    </div>
  )
}
