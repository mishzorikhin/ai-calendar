import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { useApp, useBar } from '../app/store'
import { BarChips, BarText } from '../components/BottomBar'
import { BackIcon } from '../components/Icons'
import { PlaceSheet } from '../components/PlaceSheet'
import { Avatar, CircleButton, Dots, MeDot, Pill, RestaurantLogo, Shimmer, Stack } from '../components/ui'
import { FRIEND, RESTAURANTS, SLOTS, TRANSCRIPT_DONE_AT, bookingDate, type Restaurant } from '../data'
import { formatMinutes } from '../lib/dates'
import { useTimeout } from '../lib/hooks'
import { ease, spring } from '../lib/motion'
import { BookingStep } from './agent/BookingStep'
import { FindingStep } from './agent/FindingStep'
import { TimingStep } from './agent/TimingStep'
import styles from './Agent.module.css'

type Step = 'request' | 'timing' | 'finding' | 'booking'

const STEPS = [
  { id: 'timing', label: 'Время' },
  { id: 'finding', label: 'Поиск ресторана' },
  { id: 'booking', label: 'Бронирование' },
] as const

export function Agent() {
  const { prompt, back, reset, setBooking, setSelectedDate } = useApp()
  const [step, setStep] = useState<Step>('request')
  const [slotIdx, setSlotIdx] = useState(0)
  const [findPhase, setFindPhase] = useState<'radar' | 'results'>('radar')
  const [placeIdx, setPlaceIdx] = useState(0)
  const [chosen, setChosen] = useState<Restaurant>(RESTAURANTS[0])
  const [sheet, setSheet] = useState<null | 'details' | 'reviews'>(null)
  const [seconds, setSeconds] = useState(0)
  const [transcript, setTranscript] = useState(false)
  const [listening, setListening] = useState(false)
  const done = step === 'booking' && seconds >= TRANSCRIPT_DONE_AT

  useTimeout(() => setStep('timing'), step === 'request' ? 2800 : null)
  useTimeout(() => setFindPhase('results'), step === 'finding' && findPhase === 'radar' ? 2600 : null)

  // Таймер звонка в ресторан.
  useEffect(() => {
    if (step !== 'booking' || done) return
    const id = window.setTimeout(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearTimeout(id)
  }, [step, seconds, done])

  const place = RESTAURANTS[placeIdx]

  const goFinding = () => {
    setFindPhase('radar')
    setStep('finding')
  }

  const book = (r: Restaurant) => {
    setSheet(null)
    setChosen(r)
    setSeconds(0)
    setTranscript(false)
    setListening(false)
    setStep('booking')
  }

  const finish = (openDay: boolean) => {
    const date = bookingDate()
    setBooking({ restaurant: chosen, slot: SLOTS[slotIdx], date })
    if (openDay) {
      setSelectedDate(date)
      reset('day')
    } else {
      reset('home')
    }
  }

  const goBack = () => {
    if (sheet) setSheet(null)
    else if (step === 'booking') setStep('finding')
    else if (step === 'finding') setStep('timing')
    else back()
  }

  useBar(
    {
      key: barKey(step, findPhase, done, sheet),
      hidden: sheet !== null,
      aiActive: step === 'request',
      center: barCenter(),
    },
    [step, findPhase, done, sheet, slotIdx, placeIdx, transcript, listening],
  )

  function barCenter() {
    if (step === 'request')
      return (
        <BarText>
          <Shimmer>Планирую</Shimmer>
          <Dots />
        </BarText>
      )
    if (step === 'timing')
      return (
        <BarChips>
          {SLOTS.map((s, i) => (
            <Pill key={i} small tone={i === slotIdx ? 'white' : 'glass'} onClick={() => setSlotIdx(i)} className="tnum">
              {formatMinutes(s.start)}
            </Pill>
          ))}
        </BarChips>
      )
    if (step === 'finding' && findPhase === 'radar')
      return (
        <BarText>
          <Shimmer>Ищу места рядом</Shimmer>
        </BarText>
      )
    if (step === 'finding')
      return (
        <BarChips>
          <Pill small tone="white" onClick={() => book(place)}>
            Забронировать
          </Pill>
          <Pill small tone="glass" onClick={() => setSheet('reviews')}>
            Отзывы <span style={{ color: '#f5b83d' }}>★</span> {place.rating}
          </Pill>
        </BarChips>
      )
    if (!done)
      return (
        <BarChips>
          <Pill small tone={listening ? 'white' : 'glass'} onClick={() => setListening((l) => !l)}>
            {listening ? 'Слушаю' : 'Слушать'}
          </Pill>
          <Pill small tone={transcript ? 'white' : 'glass'} onClick={() => setTranscript((t) => !t)}>
            Расшифровка
          </Pill>
        </BarChips>
      )
    return (
      <BarChips>
        <Pill small tone="white" onClick={() => finish(false)}>
          Готово
        </Pill>
        <Pill small tone="glass" onClick={() => finish(true)}>
          Открыть день
        </Pill>
      </BarChips>
    )
  }

  const activeIdx = STEPS.findIndex((s) => s.id === step)

  return (
    <>
      <div className={styles.screen}>
        <motion.header
          className={styles.header}
          initial={{ y: -30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={spring}
        >
          <CircleButton tone="gray" size={46} onClick={goBack} aria-label="Назад">
            <BackIcon size={20} />
          </CircleButton>
          <span className={styles.people}>
            <Stack overlap={10}>
              <RestaurantLogo size={36} />
              <Avatar initials={FRIEND.initials} src={FRIEND.photo} color="#dfe2f7" size={36} />
              <MeDot size={36} />
            </Stack>
          </span>
          <span style={{ width: 46 }} />
        </motion.header>

        <div className={styles.body}>
          <AnimatePresence mode="popLayout" initial={false}>
            {step === 'request' ? (
              <RequestView key="request" prompt={prompt} />
            ) : (
              <motion.div key="stack" className={styles.stack} initial={{ opacity: 1 }} animate={{ opacity: 1 }}>
                {STEPS.map((s, i) => {
                  const state = i < activeIdx ? 'before' : i === activeIdx ? 'active' : 'after'
                  const z = state === 'active' ? 10 : state === 'before' ? i + 1 : 10 - (i - activeIdx)
                  return (
                    <motion.section
                      key={s.id}
                      layout
                      initial={{ opacity: 0, y: 80 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...spring, delay: step === 'timing' && state !== 'before' ? i * 0.07 : 0 }}
                      className={`${styles.card} ${styles[state]}`}
                      style={{ zIndex: z, borderRadius: 30 }}
                    >
                      {state === 'active' ? (
                        <motion.div
                          key={`content-${s.id}`}
                          className={`${styles.content} scroll-y`}
                          layout="position"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1, transition: { duration: 0.35, delay: 0.12, ease } }}
                        >
                          {s.id === 'timing' && (
                            <TimingStep
                              slot={SLOTS[slotIdx]}
                              slotIdx={slotIdx}
                              onNextSlot={() => setSlotIdx((i) => (i + 1) % SLOTS.length)}
                              onBook={goFinding}
                            />
                          )}
                          {s.id === 'finding' && (
                            <FindingStep
                              phase={findPhase}
                              index={placeIdx}
                              onIndex={setPlaceIdx}
                              onBook={book}
                              onDetails={() => setSheet('details')}
                            />
                          )}
                          {s.id === 'booking' && (
                            <BookingStep
                              place={chosen}
                              slot={SLOTS[slotIdx]}
                              seconds={seconds}
                              done={done}
                              transcript={transcript}
                              onTranscript={() => setTranscript((t) => !t)}
                              listening={listening}
                            />
                          )}
                        </motion.div>
                      ) : (
                        <motion.button
                          type="button"
                          layout="position"
                          className={styles.tab}
                          onClick={() => state === 'before' && setStep(s.id)}
                          disabled={state === 'after'}
                        >
                          {s.label}
                        </motion.button>
                      )}
                    </motion.section>
                  )
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {sheet && (
          <PlaceSheet
            key="sheet"
            place={step === 'booking' ? chosen : place}
            focus={sheet}
            onClose={() => setSheet(null)}
            onBook={step === 'finding' ? () => book(place) : undefined}
          />
        )}
      </AnimatePresence>
    </>
  )
}

function barKey(step: Step, phase: string, done: boolean, sheet: string | null) {
  if (sheet) return 'sheet'
  if (step === 'finding') return `finding-${phase}`
  if (step === 'booking') return done ? 'booking-done' : 'booking'
  return step
}

/** Запрос пользователя крупным текстом; имя друга распознаётся как контакт. */
function RequestView({ prompt }: { prompt: string }) {
  const words = useMemo(() => prompt.split(/\s+/).filter(Boolean), [prompt])
  return (
    <motion.div
      className={styles.request}
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -50, scale: 0.92, filter: 'blur(8px)', transition: { duration: 0.4, ease } }}
      transition={spring}
    >
      <p className="caption">Чем могу помочь?</p>
      <h1 className={styles.prompt}>
        {words.map((w, i) => {
          const friend = /^глеб/i.test(w)
          const soft = friend || /^(моим|моей|другом|подругой)$/i.test(w)
          return (
            <motion.span
              key={i}
              className={soft ? styles.soft : undefined}
              initial={{ opacity: 0, y: 14, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.45, delay: 0.15 + i * 0.06, ease }}
            >
              {w}
              {friend && (
                <motion.span
                  className={styles.contact}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ ...spring, delay: 0.5 + i * 0.06 }}
                >
                  <Avatar initials={FRIEND.initials} src={FRIEND.photo} size={30} ring={false} color="#dfe2f7" />
                </motion.span>
              )}{' '}
            </motion.span>
          )
        })}
      </h1>
      <motion.span
        className={styles.thinking}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ ...spring, delay: 0.25 + words.length * 0.06 }}
      >
        <Dots />
      </motion.span>
    </motion.div>
  )
}
