import { useReducer } from 'react'
import { useAddMessage, useCancelBooking, useCreateBooking, useDayEvents, usePlaces } from '../../api/queries'
import { useAssistant } from '../../app/assistant'
import { useCalendar } from '../../app/calendar'
import { useNavigation } from '../../app/navigation'
import { findFreeSlots, slotAt } from '../../domain/calendar'
import { DEFAULT_PARAMS, dayLabel, guestsLabel, paramsDate } from '../../domain/request'
import { isOpenAt, rankPlaces } from '../../domain/restaurants'
import type { RequestParams, Restaurant } from '../../domain/types'
import { WEEKDAYS, formatMinutes } from '../../lib/dates'
import { useInterval, useTimeout } from '../../lib/hooks'
import { TRANSCRIPT_DONE_AT, transcriptFor } from '../../mocks/assistant'
import { FRIEND } from '../../mocks/people'

export type CallState = 'calling' | 'hungup' | 'done' | 'cancelled'

/**
 * Шаг сценария. Данные, которые имеют смысл только на шаге, живут внутри него,
 * поэтому невозможны комбинации вроде «звонок завершён» на шаге выбора времени.
 */
export type Flow =
  | { step: 'request' }
  | { step: 'timing' }
  | { step: 'finding'; phase: 'radar' | 'results' }
  | {
      step: 'booking'
      place: Restaurant
      /** Время брони фиксируется при звонке: дальше свободные окна могут измениться. */
      time: { start: number; end: number }
      call: CallState
      seconds: number
      transcript: boolean
      listening: boolean
    }

export type StepId = Flow['step']

/** Что открыто поверх сценария. */
export type Overlay = { kind: 'details' } | { kind: 'reviews' } | { kind: 'confirm'; place: Restaurant } | null

type State = {
  params: RequestParams
  /** Автозапуск поиска уже отработал — при возврате к запросу больше не срабатывает. */
  autoUsed: boolean
  /** Выбранное начало слота; null — первое свободное окно. */
  slotStart: number | null
  placeIdx: number
  flow: Flow
  overlay: Overlay
}

type Action =
  | { type: 'params'; params: RequestParams }
  | { type: 'search' }
  | { type: 'selectSlot'; start: number }
  | { type: 'find'; start: number }
  | { type: 'radarDone' }
  | { type: 'placeIdx'; index: number }
  | { type: 'openSheet'; kind: 'details' | 'reviews' }
  | { type: 'confirm'; place: Restaurant }
  | { type: 'closeOverlay' }
  | { type: 'call'; place: Restaurant; time: { start: number; end: number } }
  | { type: 'tick' }
  | { type: 'hangup' }
  | { type: 'cancelBooking' }
  | { type: 'toggleTranscript' }
  | { type: 'toggleListening' }
  | { type: 'goto'; step: 'timing' | 'finding' }
  | { type: 'back' }

const INITIAL: State = {
  params: DEFAULT_PARAMS,
  autoUsed: false,
  slotStart: null,
  placeIdx: 0,
  flow: { step: 'request' },
  overlay: null,
}

/** Изменить шаг брони; вне него — и если ничего не поменялось — состояние остаётся тем же объектом. */
function patchBooking(state: State, patch: (f: Extract<Flow, { step: 'booking' }>) => Flow): State {
  if (state.flow.step !== 'booking') return state
  const flow = patch(state.flow)
  return flow === state.flow ? state : { ...state, flow }
}

export function agentReducer(state: State, action: Action): State {
  switch (action.type) {
    case 'params':
      return { ...state, params: action.params }
    case 'search':
      return { ...state, autoUsed: true, flow: { step: 'timing' } }
    case 'selectSlot':
      return { ...state, slotStart: action.start }
    case 'find':
      // Выбранное окно запоминается: после брони оно станет занятым, и «первое свободное» сдвинется.
      return { ...state, slotStart: action.start, placeIdx: 0, flow: { step: 'finding', phase: 'radar' } }
    case 'radarDone':
      return state.flow.step === 'finding' ? { ...state, flow: { step: 'finding', phase: 'results' } } : state
    case 'placeIdx':
      return { ...state, placeIdx: action.index }
    case 'openSheet':
      return { ...state, overlay: { kind: action.kind } }
    case 'confirm':
      return { ...state, overlay: { kind: 'confirm', place: action.place } }
    case 'closeOverlay':
      return { ...state, overlay: null }
    case 'call':
      return {
        ...state,
        overlay: null,
        flow: {
          step: 'booking',
          place: action.place,
          time: action.time,
          call: 'calling',
          seconds: 0,
          transcript: false,
          listening: false,
        },
      }
    case 'tick':
      return patchBooking(state, (f) => {
        if (f.call !== 'calling') return f
        const seconds = f.seconds + 1
        return { ...f, seconds, call: seconds >= TRANSCRIPT_DONE_AT ? 'done' : 'calling' }
      })
    case 'hangup':
      return patchBooking(state, (f) => ({ ...f, call: 'hungup', listening: false }))
    case 'cancelBooking':
      return patchBooking(state, (f) => ({ ...f, call: 'cancelled' }))
    case 'toggleTranscript':
      return patchBooking(state, (f) => ({ ...f, transcript: !f.transcript }))
    case 'toggleListening':
      return patchBooking(state, (f) => ({ ...f, listening: !f.listening }))
    case 'goto':
      return {
        ...state,
        overlay: null,
        flow: action.step === 'timing' ? { step: 'timing' } : { step: 'finding', phase: 'results' },
      }
    case 'back':
      if (state.overlay) return { ...state, overlay: null }
      switch (state.flow.step) {
        case 'booking':
          return { ...state, flow: { step: 'finding', phase: 'results' } }
        case 'finding':
          return { ...state, flow: { step: 'timing' } }
        case 'timing':
          return { ...state, flow: { step: 'request' } }
        case 'request':
          return state
      }
  }
}

const RADAR_MS = 1700

/** Элемент списка по индексу с ограничением по краям; список мест никогда не пуст. */
function pick<T>(list: readonly T[], index: number): T {
  const item = list[Math.max(0, Math.min(index, list.length - 1))]
  if (item === undefined) throw new Error('Пустой список')
  return item
}

const NO_PLACES: Restaurant[] = []

/** Сценарий ассистента: состояние, производные данные и действия, которые выходят за пределы экрана. */
export function useAgentFlow() {
  const [state, dispatch] = useReducer(agentReducer, INITIAL)
  const { back, reset } = useNavigation()
  const { setSelectedDate } = useCalendar()
  const { prompt, setDraft } = useAssistant()
  const addMessage = useAddMessage()
  const createBooking = useCreateBooking()
  const cancelBooking = useCancelBooking()
  const { params, flow } = state

  const date = paramsDate(params)
  const when = `${dayLabel(params.dayOffset)}, ${WEEKDAYS[date.getDay()]?.toLowerCase()}`
  const { events } = useDayEvents(date)
  const { data: allPlaces = NO_PLACES } = usePlaces()
  const free = findFreeSlots(events)
  const slot =
    free.find((s) => s.start === state.slotStart) ??
    (state.slotStart !== null ? slotAt(events, state.slotStart, 90) : (free[0] ?? slotAt(events, 9 * 60, 90)))
  const places = rankPlaces(allPlaces, slot.start)
  const place = places.length > 0 ? pick(places, state.placeIdx) : null
  const lines = transcriptFor(params, formatMinutes(slot.start))
  const calling = flow.step === 'booking' && flow.call === 'calling'

  // Радар крутится, пока не загрузились места, и ещё немного — для ощущения поиска.
  useTimeout(
    () => dispatch({ type: 'radarDone' }),
    flow.step === 'finding' && flow.phase === 'radar' && places.length > 0 ? RADAR_MS : null,
  )

  // Звонок идёт по секундам; когда ресторан подтверждает, бронь сохраняется на сервере.
  useInterval(
    () => {
      if (flow.step !== 'booking' || flow.call !== 'calling') return
      if (flow.seconds + 1 >= TRANSCRIPT_DONE_AT) {
        createBooking.mutate({
          placeId: flow.place.id,
          date,
          start: flow.time.start,
          end: flow.time.end,
          guests: params.guests,
          invite: params.invite,
        })
      }
      dispatch({ type: 'tick' })
    },
    calling ? 1000 : null,
  )

  /** Забронировать можно только открытое в это время место — и только после подтверждения. */
  const askConfirm = (r: Restaurant) => {
    if (isOpenAt(r, slot.start)) dispatch({ type: 'confirm', place: r })
  }

  const startCall = (r: Restaurant) => {
    createBooking.reset()
    cancelBooking.reset()
    const time = flow.step === 'booking' ? flow.time : { start: slot.start, end: slot.end }
    dispatch({ type: 'call', place: r, time })
  }

  const cancel = () => {
    const saved = createBooking.data
    if (saved) cancelBooking.mutate(saved.id, { onSuccess: () => dispatch({ type: 'cancelBooking' }) })
    else dispatch({ type: 'cancelBooking' })
  }

  const finish = (openDay: boolean) => {
    const saved = createBooking.data
    if (flow.step !== 'booking' || !saved) return
    addMessage.mutate({
      role: 'ai',
      text: `Забронировал столик в ${saved.restaurant.name}: ${when.toLowerCase()}, ${formatMinutes(saved.slot.start)}, ${guestsLabel(saved.guests)}. Бронь ${saved.code}.${saved.invite ? ` ${FRIEND.nameDative} отправил приглашение.` : ''}`,
    })
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
    if (!state.overlay && flow.step === 'request') back()
    else dispatch({ type: 'back' })
  }

  return {
    state,
    dispatch,
    prompt,
    date,
    when,
    free,
    slot,
    places,
    place,
    placeOpen: place !== null && isOpenAt(place, slot.start),
    lines,
    /** Сохранённая бронь и состояние запросов к серверу. */
    booking: {
      saved: createBooking.data ?? null,
      saving: createBooking.isPending || cancelBooking.isPending,
      error: (createBooking.error ?? cancelBooking.error)?.message ?? null,
    },
    askConfirm,
    startCall,
    cancel,
    finish,
    editText,
    goBack,
    toHome: () => reset('home'),
  }
}

export type AgentFlow = ReturnType<typeof useAgentFlow>
