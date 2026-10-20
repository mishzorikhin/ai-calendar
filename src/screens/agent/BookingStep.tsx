import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { CheckIcon, ChevronDownIcon, CloseIcon, PhoneDownIcon, PinIcon } from '../../components/Icons'
import { PersonAvatar, Pill, Pressable, SmartImage, Waveform } from '../../components/ui'
import { guestsLabel } from '../../domain/request'
import type { Restaurant, Slot, TranscriptLine } from '../../domain/types'
import { formatMinutes, formatTimer } from '../../lib/dates'
import { bouncy, spring } from '../../lib/motion'
import { FRIEND } from '../../mocks/people'
import type { CallState } from './useAgentFlow'
import styles from './steps.module.css'

/** Шаг 3: ассистент звонит в ресторан. Звонок можно слушать, читать и прервать; готовую бронь — отменить. */
export function BookingStep({
  place,
  slot,
  when,
  guests,
  invite,
  code,
  saving,
  saveError,
  seconds,
  state,
  lines,
  transcript,
  onTranscript,
  listening,
  onHangup,
  onRetry,
  onCancelBooking,
}: {
  place: Restaurant
  slot: Slot
  when: string
  guests: number
  invite: boolean
  /** Номер брони от сервера; null — ещё не сохранена. */
  code: string | null
  saving: boolean
  saveError: string | null
  seconds: number
  state: CallState
  lines: TranscriptLine[]
  transcript: boolean
  onTranscript: () => void
  listening: boolean
  onHangup: () => void
  onRetry: () => void
  onCancelBooking: () => void
}) {
  const heard = lines.filter((l) => l.at <= seconds)
  const list = useRef<HTMLDivElement>(null)
  const [askCancel, setAskCancel] = useState(false)

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' })
  }, [heard.length, transcript])

  // Ресторан подтвердил, но бронь ещё сохраняется или не сохранилась на сервере.
  const unsaved = state === 'done' && !code
  const failed = unsaved && !saving && saveError !== null

  const title =
    state === 'calling'
      ? 'Разговор с рестораном'
      : failed
        ? 'Бронь не сохранилась'
        : unsaved
          ? 'Сохраняю бронь…'
          : state === 'done'
            ? 'Столик забронирован'
            : state === 'hungup'
              ? 'Звонок прерван'
              : 'Бронь отменена'
  const sub =
    state === 'calling'
      ? formatTimer(seconds)
      : failed
        ? saveError
        : state === 'done'
          ? `${when}, ${formatMinutes(slot.start)} · ${guestsLabel(guests)}`
          : state === 'hungup'
            ? 'Бронь не создана, ресторан ничего не записал'
            : 'Ресторан предупреждён, приглашение отозвано'

  return (
    <div className={`${styles.step} ${styles.stepFill}`}>
      <p className={styles.kicker}>Бронирование</p>
      <h2 className={styles.heading}>{place.name}</h2>

      <SmartImage src={place.photo} art={place.art} className={styles.callPhoto}>
        <AnimatePresence>
          {transcript && (
            <motion.div
              key="transcript"
              ref={list}
              className={`${styles.transcript} scroll-y`}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              transition={spring}
            >
              {heard.length === 0 && <p className={styles.lineWait}>Соединяю…</p>}
              {heard.map((l) => (
                <motion.p
                  key={l.at}
                  className={`${styles.line} ${l.who === 'ai' ? styles.lineAi : styles.linePlace}`}
                  initial={{ opacity: 0, y: 10, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={spring}
                >
                  <small>{l.who === 'ai' ? 'Ассистент' : place.name}</small>
                  {l.text}
                </motion.p>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div layout className={styles.statusCard} transition={spring}>
          <div className={styles.status}>
            <AnimatePresence mode="popLayout" initial={false}>
              {state !== 'calling' && !(unsaved && !failed) && (
                <motion.span
                  key={state}
                  className={`${styles.statusIcon} ${state === 'done' && !failed ? styles.statusOk : styles.statusOff}`}
                  initial={{ scale: 0, rotate: -40 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={bouncy}
                >
                  {state === 'done' ? (
                    <CheckIcon size={18} strokeWidth={2.6} />
                  ) : (
                    <CloseIcon size={16} strokeWidth={2.6} />
                  )}
                </motion.span>
              )}
            </AnimatePresence>
            <span className={styles.statusText} aria-live="polite">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.b
                  key={title}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={spring}
                >
                  {title}
                </motion.b>
              </AnimatePresence>
              <span className="tnum">{sub}</span>
            </span>
            {listening && state === 'calling' && (
              <span className={styles.statusWave}>
                <Waveform bars={6} height={18} color="var(--blue)" />
              </span>
            )}
            <Pressable
              className={styles.statusChevron}
              onClick={onTranscript}
              aria-label={transcript ? 'Скрыть расшифровку' : 'Показать расшифровку'}
              aria-expanded={transcript}
            >
              <motion.span animate={{ rotate: transcript ? 180 : 0 }} transition={spring} style={{ display: 'flex' }}>
                <ChevronDownIcon size={18} strokeWidth={2.2} />
              </motion.span>
              {!transcript && heard.length > 0 && state === 'calling' && (
                <motion.i key={heard.length} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={bouncy} />
              )}
            </Pressable>
            {state === 'calling' && (
              <Pressable className={styles.hangup} onClick={onHangup} aria-label="Прервать звонок">
                <PhoneDownIcon size={20} />
              </Pressable>
            )}
          </div>

          {failed && (
            <div className={styles.retry}>
              <Pill small tone="dark" onClick={onRetry}>
                Сохранить ещё раз
              </Pill>
            </div>
          )}

          <AnimatePresence initial={false}>
            {state === 'done' && code && (
              <motion.div
                key="details"
                className={styles.details}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={spring}
              >
                <p>
                  <PinIcon size={14} /> {place.address} · бронь <b className="tnum">{code}</b>
                </p>
                {invite && (
                  <p>
                    <PersonAvatar person={FRIEND} size={16} ring={false} />
                    {FRIEND.nameDative} отправлено приглашение
                  </p>
                )}
                <AnimatePresence mode="popLayout" initial={false}>
                  {askCancel ? (
                    <motion.div
                      key="ask"
                      className={styles.askCancel}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                    >
                      <span>Отменить бронь?</span>
                      <Pill small tone="dark" onClick={onCancelBooking} disabled={saving}>
                        Да, отменить
                      </Pill>
                      <Pill small tone="ghost" onClick={() => setAskCancel(false)}>
                        Нет
                      </Pill>
                    </motion.div>
                  ) : (
                    <motion.div key="link" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <Pressable className={styles.cancelLink} onClick={() => setAskCancel(true)}>
                        Отменить бронь
                      </Pressable>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </SmartImage>
    </div>
  )
}
