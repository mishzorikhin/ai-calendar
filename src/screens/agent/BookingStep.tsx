import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { ChatIcon, CheckIcon, ChevronDownIcon } from '../../components/Icons'
import { Pressable, SmartImage, Waveform } from '../../components/ui'
import { TRANSCRIPT, type Restaurant, type Slot } from '../../data'
import { formatMinutes, formatTimer } from '../../lib/dates'
import { bouncy, spring } from '../../lib/motion'
import styles from './steps.module.css'

/** Шаг 3: ассистент звонит в ресторан; можно слушать разговор и читать расшифровку. */
export function BookingStep({
  place,
  slot,
  seconds,
  done,
  transcript,
  onTranscript,
  listening,
}: {
  place: Restaurant
  slot: Slot
  seconds: number
  done: boolean
  transcript: boolean
  onTranscript: () => void
  listening: boolean
}) {
  const lines = TRANSCRIPT.filter((l) => l.at <= seconds)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' })
  }, [lines.length, transcript])

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
              {lines.length === 0 && <p className={styles.lineWait}>Соединяю…</p>}
              {lines.map((l) => (
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

        <motion.div layout className={styles.status} transition={spring}>
          <AnimatePresence mode="popLayout" initial={false}>
            {done ? (
              <motion.span
                key="ok"
                className={styles.statusOk}
                initial={{ scale: 0, rotate: -40 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={bouncy}
              >
                <CheckIcon size={18} strokeWidth={2.6} />
                <motion.i
                  initial={{ scale: 1, opacity: 0.6 }}
                  animate={{ scale: 2.2, opacity: 0 }}
                  transition={{ duration: 0.9 }}
                />
              </motion.span>
            ) : null}
          </AnimatePresence>
          <span className={styles.statusText}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.b
                key={done ? 'done' : 'call'}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={spring}
              >
                {done ? 'Столик забронирован' : 'Разговор с рестораном'}
              </motion.b>
            </AnimatePresence>
            <span className="tnum">
              {done ? `Завтра, ${formatMinutes(slot.start)} · 2 гостя` : formatTimer(seconds)}
            </span>
          </span>
          {listening && !done && (
            <span className={styles.statusWave}>
              <Waveform bars={7} height={18} color="#3a78f2" />
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
          </Pressable>
          <Pressable className={styles.statusChat} onClick={onTranscript} aria-label="Расшифровка">
            <ChatIcon size={18} />
            {!transcript && lines.length > 0 && !done && (
              <motion.i key={lines.length} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={bouncy} />
            )}
          </Pressable>
        </motion.div>
      </SmartImage>
    </div>
  )
}
