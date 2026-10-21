import { AnimatePresence, m } from 'framer-motion'
import { useState } from 'react'
import { useIntegrations } from '../../../api/queries'
import { BottomSheet } from '../../../components/BottomSheet'
import { BackIcon, CloseIcon } from '../../../components/Icons'
import { CircleButton } from '../../../components/ui'
import { useNow } from '../../../lib/hooks'
import { spring } from '../../../lib/motion'
import { CalDavForm } from './CalDavForm'
import { ConnectOptions } from './ConnectOptions'
import { FeedCard } from './FeedCard'
import { IcsForm } from './IcsForm'
import { IntegrationRow } from './IntegrationRow'
import type { OAuthReturn } from './oauthReturn'
import styles from './Calendars.module.css'

type View = 'list' | 'caldav' | 'ics'

const TITLES: Record<View, string> = { list: 'Календари', caldav: 'CalDAV', ics: 'Подписка' }

/** Шторка «Календари»: подключённые внешние календари, подключение новых, лента .ics. */
export function CalendarsSheet({ onClose, notice: initial }: { onClose: () => void; notice?: OAuthReturn | null }) {
  const [view, setView] = useState<View>('list')
  const [notice, setNotice] = useState<OAuthReturn | null>(initial ?? null)
  const { info, isError } = useIntegrations()
  const now = useNow()

  const done = (message: string) => {
    setNotice({ ok: true, message })
    setView('list')
  }

  return (
    <BottomSheet label="Календари" onClose={onClose}>
      <div className={styles.head}>
        <div className={styles.headBack}>
          {view !== 'list' && (
            <CircleButton tone="gray" size={44} onClick={() => setView('list')} aria-label="Назад">
              <BackIcon size={18} />
            </CircleButton>
          )}
          <h2>{TITLES[view]}</h2>
        </div>
        <CircleButton tone="gray" size={44} onClick={onClose} aria-label="Закрыть">
          <CloseIcon size={18} />
        </CircleButton>
      </div>

      <AnimatePresence mode="popLayout" initial={false}>
        <m.div
          key={view}
          initial={{ opacity: 0, x: view === 'list' ? -24 : 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: view === 'list' ? 24 : -24 }}
          transition={spring}
        >
          {view === 'caldav' && <CalDavForm onDone={done} />}
          {view === 'ics' && <IcsForm onDone={done} />}
          {view === 'list' && (
            <>
              <p className={styles.lead}>
                События из других календарей появятся рядом с вашими, а ассистент будет их учитывать.
              </p>
              {notice && (
                <p className={`${styles.notice} ${notice.ok ? styles.noticeOk : styles.noticeError}`} role="status">
                  {notice.message}
                </p>
              )}

              {info.items.length > 0 && (
                <>
                  <p className={styles.label}>Подключены</p>
                  <ul className={styles.list}>
                    {info.items.map((item) => (
                      <IntegrationRow key={item.id} item={item} now={now} />
                    ))}
                  </ul>
                </>
              )}
              {isError && <p className={styles.error}>Список календарей не загрузился — проверьте соединение</p>}

              <p className={styles.label}>Подключить</p>
              <ConnectOptions
                providers={info.providers}
                onCalDav={() => setView('caldav')}
                onIcs={() => setView('ics')}
              />

              <p className={styles.label}>Этот календарь в других приложениях</p>
              <FeedCard />
            </>
          )}
        </m.div>
      </AnimatePresence>
    </BottomSheet>
  )
}
