import { BarSlot } from '../../app/bar'
import { BarChips, BarText } from '../../components/BottomBar'
import { Pill, Shimmer } from '../../components/ui'
import type { AgentFlow } from './useAgentFlow'

/** Содержимое нижней панели на каждом шаге ассистента. */
export function AgentBar({ agent }: { agent: AgentFlow }) {
  const { state, dispatch, place, placeOpen, askConfirm, finish, toHome } = agent
  const { flow, overlay, params } = state
  const hidden = overlay !== null

  if (flow.step === 'request')
    return (
      <BarSlot id="request" hidden={hidden} aiActive>
        <BarText>Проверьте, как я понял запрос</BarText>
      </BarSlot>
    )

  if (flow.step === 'timing')
    return (
      <BarSlot id="timing" hidden={hidden}>
        <BarText>Шаг 1 из 3 · выбор времени</BarText>
      </BarSlot>
    )

  if (flow.step === 'finding' && flow.phase === 'radar')
    return (
      <BarSlot id="radar" hidden={hidden}>
        <BarText>
          <Shimmer>Ищу места в радиусе {params.radiusKm} км</Shimmer>
        </BarText>
      </BarSlot>
    )

  if (flow.step === 'finding')
    return (
      <BarSlot id={`results-${placeOpen}`} hidden={hidden}>
        <BarChips>
          {placeOpen ? (
            <Pill small tone="white" onClick={() => askConfirm(place)}>
              Забронировать
            </Pill>
          ) : (
            <Pill small tone="white" onClick={() => dispatch({ type: 'goto', step: 'timing' })}>
              Другое время
            </Pill>
          )}
          <Pill small tone="glass" onClick={() => dispatch({ type: 'openSheet', kind: 'reviews' })}>
            Отзывы
          </Pill>
        </BarChips>
      </BarSlot>
    )

  switch (flow.call) {
    case 'calling':
      return (
        <BarSlot id="calling" hidden={hidden}>
          <BarChips>
            <Pill
              small
              tone={flow.listening ? 'white' : 'glass'}
              aria-pressed={flow.listening}
              onClick={() => dispatch({ type: 'toggleListening' })}
            >
              {flow.listening ? 'Слушаю звонок' : 'Слушать'}
            </Pill>
            <Pill
              small
              tone={flow.transcript ? 'white' : 'glass'}
              aria-pressed={flow.transcript}
              onClick={() => dispatch({ type: 'toggleTranscript' })}
            >
              Расшифровка
            </Pill>
          </BarChips>
        </BarSlot>
      )
    case 'done':
      return (
        <BarSlot id="done" hidden={hidden}>
          <BarChips>
            <Pill small tone="white" onClick={() => finish(false)}>
              Готово
            </Pill>
            <Pill small tone="glass" onClick={() => finish(true)}>
              Открыть день
            </Pill>
          </BarChips>
        </BarSlot>
      )
    case 'hungup':
      return (
        <BarSlot id="hungup" hidden={hidden}>
          <BarChips>
            <Pill small tone="white" onClick={() => dispatch({ type: 'call', place: flow.place })}>
              Перезвонить
            </Pill>
            <Pill small tone="glass" onClick={() => dispatch({ type: 'goto', step: 'finding' })}>
              Другое место
            </Pill>
          </BarChips>
        </BarSlot>
      )
    case 'cancelled':
      return (
        <BarSlot id="cancelled" hidden={hidden}>
          <BarChips>
            <Pill small tone="white" onClick={() => dispatch({ type: 'goto', step: 'finding' })}>
              Другое место
            </Pill>
            <Pill small tone="glass" onClick={toHome}>
              На главную
            </Pill>
          </BarChips>
        </BarSlot>
      )
  }
}
