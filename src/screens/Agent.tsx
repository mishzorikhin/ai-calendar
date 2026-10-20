import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { useApp, useBar } from '../app/store'
import { BarChips, BarText } from '../components/BottomBar'
import { BackIcon } from '../components/Icons'
import { PlaceSheet } from '../components/PlaceSheet'
import { Avatar, CircleButton, MeDot, Pill, RestaurantLogo, Shimmer, Stack } from '../components/ui'
import {
  DEFAULT_PARAMS,
  FRIEND,
  RESTAURANTS,
  TRANSCRIPT_DONE_AT,
  dayLabel,
  eventsFor,
  findFreeSlots,
  guestsLabel,
  paramsDate,
  slotAt,
  transcriptFor,
  type RequestParams,
  type Restaurant,
} from '../data'
import { WEEKDAYS, formatMinutes } from '../lib/dates'
import { ease, spring } from '../lib/motion'
import { BookingStep, type CallState } from './agent/BookingStep'
import { ConfirmSheet } from './agent/ConfirmSheet'
import { FindingStep, isOpenAt } from './agent/FindingStep'
import { RequestStep } from './agent/RequestStep'
import { TimingStep } from './agent/TimingStep'
import styles from './Agent.module.css'

type Step = 'request' | 'timing' | 'finding' | 'booking'

const STEPS = [
  { id: 'timing', label: 'Время' },
  { id: 'finding', label: 'Поиск ресторана' },
  { id: 'booking', label: 'Бронирование' },
] as const

const BOOKING_CODE = 'A-4821'

export function Agent() {
  const { prompt, back, reset, booking, customEvents, setBooking, setSelectedDate, setDraft, addMessage } = useApp()
  const [step, setStep] = useState<Step>('request')
  const [params, setParams] = useState<RequestParams>(DEFAULT_PARAMS)
  const [autoUsed, setAutoUsed] = useState(false)
  const [slotStart, setSlotStart] = useState<number | null>(null)
  const [findPhase, setFindPhase] = useState<'radar' | 'results'>('radar')
  const [placeIdx, setPlaceIdx] = useState(0)
  const [chosen, setChosen] = useState<Restaurant>(RESTAURANTS[0])
  const [sheet, setSheet] = useState<null | 'details' | 'reviews'>(null)
  const [confirm, setConfirm] = useState<Restaurant | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [call, setCall] = useState<CallState>('calling')
  const [transcript, setTranscript] = useState(false)
  const [listening, setListening] = useState(false)

  const date = paramsDate(params)
  const when = `${dayLabel(params.dayOffset)}, ${WEEKDAYS[date.getDay()].toLowerCase()}`
  const events = useMemo(
    () => eventsFor(date, booking, customEvents),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.dayOffset, booking, customEvents],
  )
  const free = useMemo(() => findFreeSlots(events), [events])
  const slot =
    free.find((s) => s.start === slotStart) ??
    (slotStart !== null ? slotAt(events, slotStart, 90) : (free[0] ?? slotAt(events, 9 * 60, 90)))

  // Сначала места, открытые в выбранное время, затем по рейтингу.
  const places = useMemo(
    () =>
      [...RESTAURANTS].sort(
        (a, b) => Number(isOpenAt(b, slot.start)) - Number(isOpenAt(a, slot.start)) || b.rating - a.rating,
      ),
    [slot.start],
  )
  const place = places[Math.min(placeIdx, places.length - 1)]
  const placeOpen = isOpenAt(place, slot.start)
  const lines = useMemo(() => transcriptFor(params, formatMinutes(slot.start)), [params, slot.start])

  useEffect(() => {
    if (step !== 'finding' || findPhase !== 'radar') return
    const id = window.setTimeout(() => setFindPhase('results'), 1700)
    return () => window.clearTimeout(id)
  }, [step, findPhase])

  // Таймер звонка; разговор заканчивается бронью.
  useEffect(() => {
    if (step !== 'booking' || call !== 'calling') return
    if (seconds >= TRANSCRIPT_DONE_AT) {
      setCall('done')
      return
    }
    const id = window.setTimeout(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearTimeout(id)
  }, [step, call, seconds])

  const toTiming = () => {
    setAutoUsed(true)
    setStep('timing')
  }

  const toFinding = () => {
    setFindPhase('radar')
    setPlaceIdx(0)
    setStep('finding')
  }

  const askConfirm = (r: Restaurant) => {
    if (!isOpenAt(r, slot.start)) return
    setSheet(null)
    setConfirm(r)
  }

  const startCall = (r: Restaurant) => {
    setConfirm(null)
    setChosen(r)
    setSeconds(0)
    setCall('calling')
    setTranscript(false)
    setListening(false)
    setStep('booking')
  }

  const finish = (openDay: boolean) => {
    setBooking({ restaurant: chosen, slot, date, guests: params.guests, invite: params.invite, code: BOOKING_CODE })
    addMessage(
      'ai',
      `Забронировал столик в ${chosen.name}: ${when.toLowerCase()}, ${formatMinutes(slot.start)}, ${guestsLabel(params.guests)}. Бронь ${BOOKING_CODE}.${params.invite ? ' Глебу отправил приглашение.' : ''}`,
    )
    if (openDay) {
      setSelectedDate(date)
      reset('day')
    } else {
      reset('home')
    }
  }

  const editText = () => {
    setDraft(prompt)
    reset('chat')
  }

  const goBack = () => {
    if (confirm) setConfirm(null)
    else if (sheet) setSheet(null)
    else if (step === 'booking') setStep('finding')
    else if (step === 'finding') setStep('timing')
    else if (step === 'timing') setStep('request')
    else back()
  }

  useBar(
    {
      key: barKey(),
      hidden: sheet !== null || confirm !== null,
      aiActive: step === 'request',
      center: barCenter(),
    },
    [step, findPhase, call, sheet, confirm, placeIdx, transcript, listening, placeOpen, params.radiusKm],
  )

  function barKey() {
    if (sheet || confirm) return 'sheet'
    if (step === 'finding') return `finding-${findPhase}-${placeOpen}`
    if (step === 'booking') return `booking-${call}`
    return step
  }

  function barCenter() {
    if (step === 'request') return <BarText>Проверьте, как я понял запрос</BarText>
    if (step === 'timing') return <BarText>Шаг 1 из 3 · выбор времени</BarText>
    if (step === 'finding' && findPhase === 'radar')
      return (
        <BarText>
          <Shimmer>Ищу места в радиусе {params.radiusKm} км</Shimmer>
        </BarText>
      )
    if (step === 'finding')
      return (
        <BarChips>
          {placeOpen ? (
            <Pill small tone="white" onClick={() => askConfirm(place)}>
              Забронировать
            </Pill>
          ) : (
            <Pill small tone="white" onClick={() => setStep('timing')}>
              Другое время
            </Pill>
          )}
          <Pill small tone="glass" onClick={() => setSheet('reviews')}>
            Отзывы
          </Pill>
        </BarChips>
      )
    if (call === 'calling')
      return (
        <BarChips>
          <Pill
            small
            tone={listening ? 'white' : 'glass'}
            aria-pressed={listening}
            onClick={() => setListening((l) => !l)}
          >
            {listening ? 'Слушаю звонок' : 'Слушать'}
          </Pill>
          <Pill
            small
            tone={transcript ? 'white' : 'glass'}
            aria-pressed={transcript}
            onClick={() => setTranscript((t) => !t)}
          >
            Расшифровка
          </Pill>
        </BarChips>
      )
    if (call === 'done')
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
    if (call === 'hungup')
      return (
        <BarChips>
          <Pill small tone="white" onClick={() => startCall(chosen)}>
            Перезвонить
          </Pill>
          <Pill small tone="glass" onClick={() => setStep('finding')}>
            Другое место
          </Pill>
        </BarChips>
      )
    return (
      <BarChips>
        <Pill small tone="white" onClick={() => setStep('finding')}>
          Другое место
        </Pill>
        <Pill small tone="glass" onClick={() => reset('home')}>
          На главную
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
          <span className={styles.people} aria-label="Участники: ресторан, Глеб и вы">
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
              <motion.div
                key="request"
                className={`${styles.request} scroll-y`}
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -50, scale: 0.92, filter: 'blur(8px)', transition: { duration: 0.35, ease } }}
                transition={spring}
              >
                <RequestStep
                  prompt={prompt}
                  params={params}
                  auto={!autoUsed}
                  onParams={setParams}
                  onContinue={toTiming}
                  onEditText={editText}
                />
              </motion.div>
            ) : (
              <motion.div key="stack" className={styles.stack}>
                {STEPS.map((s, i) => {
                  const state = i < activeIdx ? 'before' : i === activeIdx ? 'active' : 'after'
                  const z = state === 'active' ? 10 : state === 'before' ? i + 1 : 10 - (i - activeIdx)
                  return (
                    <motion.section
                      key={s.id}
                      layout
                      initial={{ opacity: 0, y: 80 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...spring, delay: step === 'timing' && state !== 'before' ? i * 0.05 : 0 }}
                      className={`${styles.card} ${styles[state]}`}
                      style={{ zIndex: z, borderRadius: 30 }}
                    >
                      {state === 'active' ? (
                        <motion.div
                          key={`content-${s.id}`}
                          className={`${styles.content} scroll-y`}
                          layout="position"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1, transition: { duration: 0.3, delay: 0.1, ease } }}
                        >
                          {s.id === 'timing' && (
                            <TimingStep
                              slot={slot}
                              alternatives={free}
                              when={when}
                              onSelect={setSlotStart}
                              onBook={toFinding}
                            />
                          )}
                          {s.id === 'finding' && (
                            <FindingStep
                              phase={findPhase}
                              places={places}
                              time={slot.start}
                              radiusKm={params.radiusKm}
                              index={placeIdx}
                              onIndex={setPlaceIdx}
                              onBook={askConfirm}
                              onDetails={() => setSheet('details')}
                            />
                          )}
                          {s.id === 'booking' && (
                            <BookingStep
                              place={chosen}
                              slot={slot}
                              when={dayLabel(params.dayOffset)}
                              guests={params.guests}
                              invite={params.invite}
                              code={BOOKING_CODE}
                              seconds={seconds}
                              state={call}
                              lines={lines}
                              transcript={transcript}
                              onTranscript={() => setTranscript((t) => !t)}
                              listening={listening}
                              onHangup={() => setCall('hungup')}
                              onCancelBooking={() => setCall('cancelled')}
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
                          aria-label={
                            state === 'before' ? `Вернуться к шагу «${s.label}»` : `${s.label} — следующий шаг`
                          }
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
            onBook={step === 'finding' && placeOpen ? () => askConfirm(place) : undefined}
          />
        )}
        {confirm && (
          <ConfirmSheet
            key="confirm"
            place={confirm}
            slot={slot}
            when={when}
            params={params}
            onParams={setParams}
            onConfirm={() => startCall(confirm)}
            onClose={() => setConfirm(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}
