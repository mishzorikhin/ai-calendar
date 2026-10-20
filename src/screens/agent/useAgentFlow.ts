import { useReducer } from 'react'
import { useAssistant } from '../../app/assistant'
import { useCalendar } from '../../app/calendar'
import { useNavigation } from '../../app/navigation'
import { findFreeSlots, slotAt } from '../../domain/calendar'
import { DEFAULT_PARAMS, dayLabel, guestsLabel, paramsDate } from '../../domain/request'
import { isOpenAt, rankPlaces } from '../../domain/restaurants'
import type { RequestParams, Restaurant } from '../../domain/types'
import { WEEKDAYS, formatMinutes } from '../../lib/dates'
import { useInterval, useTimeout } from '../../lib/hooks'
import { BOOKING_CODE, TRANSCRIPT_DONE_AT, transcriptFor } from '../../mocks/assistant'
import { eventsFor } from '../../mocks/calendar'
import { FRIEND } from '../../mocks/people'
import { RESTAURANTS } from '../../mocks/restaurants'

export type CallState = 'calling' | 'hungup' | 'done' | 'cancelled'

/**
 * Шаг сценария. Данные, которые имеют смысл только на шаге, живут внутри него,
 * поэтому невозможны комбинации вроде «звонок завершён» на шаге выбора времени.
 */
export type Flow =
  | { step: 'request' }
  | { step: 'timing' }
  | { step: 'finding'; phase: 'radar' | 'results' }
  | { step: 'booking'; place: Restaurant; call: CallState; seconds: number; transcript: boolean; listening: boolean }

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
  | { type: 'find' }
  | { type: 'radarDone' }
  | { type: 'placeIdx'; index: number }
  | { type: 'openSheet'; kind: 'details' | 'reviews' }
  | { type: 'confirm'; place: Restaurant }
  | { type: 'closeOverlay' }
  | { type: 'call'; place: Restaurant }
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
      return { ...state, placeIdx: 0, flow: { step: 'finding', phase: 'radar' } }
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

/** Сценарий ассистента: состояние, производные данные и действия, которые выходят за пределы экрана. */
export function useAgentFlow() {
  const [state, dispatch] = useReducer(agentReducer, INITIAL)
  const { back, reset } = useNavigation()
  const { booking, customEvents, setBooking, setSelectedDate } = useCalendar()
  const { prompt, setDraft, addMessage } = useAssistant()
  const { params, flow } = state

  const date = paramsDate(params)
  const when = `${dayLabel(params.dayOffset)}, ${WEEKDAYS[date.getDay()]?.toLowerCase()}`
  const events = eventsFor(date, booking, customEvents)
  const free = findFreeSlots(events)
  const slot =
    free.find((s) => s.start === state.slotStart) ??
    (state.slotStart !== null ? slotAt(events, state.slotStart, 90) : (free[0] ?? slotAt(events, 9 * 60, 90)))
  const places = rankPlaces(RESTAURANTS, slot.start)
  const place = pick(places, state.placeIdx)
  const lines = transcriptFor(params, formatMinutes(slot.start))

  useTimeout(() => dispatch({ type: 'radarDone' }), flow.step === 'finding' && flow.phase === 'radar' ? RADAR_MS : null)
  useInterval(() => dispatch({ type: 'tick' }), flow.step === 'booking' && flow.call === 'calling' ? 1000 : null)

  /** Забронировать можно только открытое в это время место — и только после подтверждения. */
  const askConfirm = (r: Restaurant) => {
    if (isOpenAt(r, slot.start)) dispatch({ type: 'confirm', place: r })
  }

  const finish = (openDay: boolean) => {
    if (flow.step !== 'booking') return
    const restaurant = flow.place
    setBooking({ restaurant, slot, date, guests: params.guests, invite: params.invite, code: BOOKING_CODE })
    addMessage(
      'ai',
      `Забронировал столик в ${restaurant.name}: ${when.toLowerCase()}, ${formatMinutes(slot.start)}, ${guestsLabel(params.guests)}. Бронь ${BOOKING_CODE}.${params.invite ? ` ${FRIEND.nameDative} отправил приглашение.` : ''}`,
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
    placeOpen: isOpenAt(place, slot.start),
    lines,
    askConfirm,
    finish,
    editText,
    goBack,
    toHome: () => reset('home'),
  }
}

export type AgentFlow = ReturnType<typeof useAgentFlow>
