import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../../domain/request'
import type { Restaurant } from '../../domain/types'
import { TRANSCRIPT_DONE_AT } from '../../mocks/assistant'
import { RESTAURANTS } from '../../mocks/restaurants'
import { agentReducer } from './useAgentFlow'

type State = Parameters<typeof agentReducer>[0]

const place = RESTAURANTS[0] as Restaurant
const time = { start: 540, end: 630 }
const start: State = {
  params: DEFAULT_PARAMS,
  autoUsed: false,
  slotStart: null,
  placeIdx: 0,
  flow: { step: 'request' },
  overlay: null,
}

const run = (state: State, ...actions: Parameters<typeof agentReducer>[1][]) => actions.reduce(agentReducer, state)

describe('agentReducer', () => {
  it('проходит сценарий до звонка только через подтверждение', () => {
    const s = run(
      start,
      { type: 'search' },
      { type: 'find', start: 540 },
      { type: 'radarDone' },
      { type: 'confirm', place },
    )
    expect(s.autoUsed).toBe(true)
    expect(s.flow).toEqual({ step: 'finding', phase: 'results' })
    expect(s.overlay).toEqual({ kind: 'confirm', place })

    const calling = agentReducer(s, { type: 'call', place, time })
    expect(calling.overlay).toBeNull()
    expect(calling.flow).toMatchObject({ step: 'booking', call: 'calling', seconds: 0, time })
    expect(s.slotStart).toBe(540)
  })

  it('звонок завершается бронью на нужной секунде', () => {
    let s = run(start, { type: 'call', place, time })
    for (let i = 0; i < TRANSCRIPT_DONE_AT; i++) s = agentReducer(s, { type: 'tick' })
    expect(s.flow).toMatchObject({ call: 'done', seconds: TRANSCRIPT_DONE_AT })
    // После брони таймер больше ничего не меняет.
    expect(agentReducer(s, { type: 'tick' })).toBe(s)
  })

  it('прерванный звонок не превращается в бронь', () => {
    let s = run(start, { type: 'call', place, time }, { type: 'toggleListening' }, { type: 'hangup' })
    expect(s.flow).toMatchObject({ call: 'hungup', listening: false })
    s = agentReducer(s, { type: 'tick' })
    expect(s.flow).toMatchObject({ call: 'hungup', seconds: 0 })
  })

  it('действия звонка вне шага брони игнорируются', () => {
    const timing = run(start, { type: 'search' })
    expect(agentReducer(timing, { type: 'hangup' })).toBe(timing)
    expect(agentReducer(timing, { type: 'tick' })).toBe(timing)
  })

  it('«назад»: сначала закрывает шторку, затем идёт по шагам', () => {
    let s = run(start, { type: 'call', place, time }, { type: 'openSheet', kind: 'details' })
    s = agentReducer(s, { type: 'back' })
    expect(s.overlay).toBeNull()
    expect(s.flow.step).toBe('booking')
    s = run(s, { type: 'back' }, { type: 'back' }, { type: 'back' })
    expect(s.flow.step).toBe('request')
    expect(agentReducer(s, { type: 'back' })).toBe(s)
  })
})
