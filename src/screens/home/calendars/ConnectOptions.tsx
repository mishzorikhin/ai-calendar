import { apiErrorText } from '../../../api/api'
import { useStartOAuth } from '../../../api/queries'
import { ArrowRightIcon } from '../../../components/Icons'
import { Pressable } from '../../../components/ui'
import type { IntegrationKind, IntegrationsInfo } from '../../../domain/types'
import { KindTile } from './IntegrationRow'
import styles from './Calendars.module.css'

type Option = { kind: IntegrationKind; title: string; sub: string; onPick: () => void }

/** Способы подключить календарь: вход в Google/Microsoft, CalDAV, подписка по ссылке. */
export function ConnectOptions({
  providers,
  onCalDav,
  onIcs,
}: {
  providers: IntegrationsInfo['providers']
  onCalDav: () => void
  onIcs: () => void
}) {
  const oauth = useStartOAuth()
  const options: Option[] = []
  if (providers.google) {
    options.push({
      kind: 'google',
      title: 'Google Календарь',
      sub: 'Вход через Google, в обе стороны',
      onPick: () => oauth.mutate('google'),
    })
  }
  if (providers.outlook) {
    options.push({
      kind: 'outlook',
      title: 'Outlook',
      sub: 'Microsoft 365 и Outlook.com',
      onPick: () => oauth.mutate('outlook'),
    })
  }
  options.push(
    {
      kind: 'caldav',
      title: 'Яндекс, iCloud и другие',
      sub: 'CalDAV, в обе стороны',
      onPick: onCalDav,
    },
    { kind: 'ics', title: 'Подписка по ссылке', sub: 'Адрес .ics — только просмотр', onPick: onIcs },
  )

  return (
    <>
      <div className={styles.list}>
        {options.map((o) => (
          <Pressable key={o.kind} className={styles.option} scale={0.98} onClick={o.onPick} disabled={oauth.isPending}>
            <KindTile kind={o.kind} />
            <span className={styles.optionText}>
              <span className={styles.optionTitle}>{o.title}</span>
              <span className={styles.optionSub}>{o.sub}</span>
            </span>
            <ArrowRightIcon size={16} strokeWidth={2.2} className={styles.chevron} />
          </Pressable>
        ))}
      </div>
      {!providers.google && (
        <p className={styles.hint}>
          Google без входа: в настройках календаря скопируйте «Секретный адрес в формате iCal» и добавьте его как
          подписку.
        </p>
      )}
      {oauth.error && (
        <p className={styles.error} role="alert">
          {apiErrorText(oauth.error)}
        </p>
      )}
    </>
  )
}
