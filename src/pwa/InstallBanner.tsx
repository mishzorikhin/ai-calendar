import { AnimatePresence, m } from 'framer-motion'
import { useState } from 'react'
import { CloseIcon } from '../components/Icons'
import { CircleButton, Pill } from '../components/ui'
import { spring } from '../lib/motion'
import { readFlag, writeFlag } from '../lib/storage'
import { useInstall } from './install'
import styles from './pwa.module.css'

const DISMISS_KEY = 'ai-calendar:install-dismissed'

/** Предложение установить приложение: кнопка там, где браузер умеет, и подсказка для iOS. */
export function InstallBanner() {
  const state = useInstall()
  const [dismissed, setDismissed] = useState(() => readFlag(DISMISS_KEY))
  const visible = !dismissed && (state.kind === 'prompt' || state.kind === 'ios')

  const dismiss = () => {
    setDismissed(true)
    writeFlag(DISMISS_KEY)
  }

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <m.aside
          className={styles.install}
          aria-label="Установка приложения"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={spring}
        >
          <div className={styles.installInner}>
            <img src="./icon-192.png" alt="" width={44} height={44} className={styles.installIcon} />
            <div className={styles.installText}>
              <b>Установите приложение</b>
              {state.kind === 'ios' ? (
                <span>
                  Нажмите «Поделиться» <ShareGlyph /> и выберите «На экран „Домой“»
                </span>
              ) : (
                <span>Откроется на весь экран и будет работать без сети</span>
              )}
            </div>
            {state.kind === 'prompt' && (
              <Pill small tone="dark" onClick={() => void state.install()}>
                Установить
              </Pill>
            )}
            <CircleButton tone="gray" size={40} onClick={dismiss} aria-label="Скрыть предложение установки">
              <CloseIcon size={16} />
            </CircleButton>
          </div>
        </m.aside>
      )}
    </AnimatePresence>
  )
}

/** Значок «Поделиться» из Safari. */
function ShareGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-label="Поделиться" role="img" className={styles.share}>
      <path
        d="M12 3v12M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
