import type { CalendarEvent } from '../domain/types'
import { mapLink } from './EventDetails'
import { LinkIcon, MapIcon, VideoIcon } from './Icons'
import styles from './EventComposer.module.css'

const MEETING =
  /meet\.google\.com|zoom\.us|teams\.(microsoft|live)\.com|telemost|jazz|salutejazz|meet\.jit\.si|webex|whereby|ktalk/

/** Ссылка на созвон — «Подключиться», иначе «Открыть ссылку». */
export const isMeetingLink = (url: string) => MEETING.test(url)

/** Быстрые действия события: подключиться к созвону, открыть место на карте; заметки — текстом. */
export function EventLinks({ event, notes = true }: { event: CalendarEvent; notes?: boolean }) {
  const place = event.subtitle?.trim()
  if (!event.url && !place && !(notes && event.notes)) return null
  return (
    <>
      {(event.url || place) && (
        <div className={styles.links}>
          {event.url && (
            <a
              className={`${styles.linkPill} ${isMeetingLink(event.url) ? styles.linkJoin : ''}`}
              href={event.url}
              target="_blank"
              rel="noreferrer"
            >
              {isMeetingLink(event.url) ? <VideoIcon size={16} /> : <LinkIcon size={16} />}
              {isMeetingLink(event.url) ? 'Подключиться' : 'Открыть ссылку'}
            </a>
          )}
          {place && (
            <a className={styles.linkPill} href={mapLink(place)} target="_blank" rel="noreferrer">
              <MapIcon size={16} /> На карте
            </a>
          )}
        </div>
      )}
      {notes && event.notes && <p className={styles.notesText}>{event.notes}</p>}
    </>
  )
}
