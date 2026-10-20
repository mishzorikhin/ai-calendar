import { AnimatePresence, motion } from 'framer-motion'
import { BackIcon } from '../../components/Icons'
import { CircleButton, MeDot, PersonAvatar, RestaurantLogo, Stack } from '../../components/ui'
import { dayLabel } from '../../domain/request'
import { ease, spring } from '../../lib/motion'
import { BOOKING_CODE } from '../../mocks/assistant'
import { FRIEND } from '../../mocks/people'
import { AgentBar } from './AgentBar'
import { BookingStep } from './BookingStep'
import { ConfirmSheet } from './ConfirmSheet'
import { FindingStep } from './FindingStep'
import { PlaceSheet } from './PlaceSheet'
import { RequestStep } from './RequestStep'
import { StepStack } from './StepStack'
import { TimingStep } from './TimingStep'
import { useAgentFlow } from './useAgentFlow'
import styles from './Agent.module.css'

/** Экран ассистента: запрос → время → место → бронь. Логика — в useAgentFlow. */
export function Agent() {
  const agent = useAgentFlow()
  const { state, dispatch, slot, places, place, placeOpen, lines, when } = agent
  const { flow, overlay, params } = state

  return (
    <>
      <AgentBar agent={agent} />

      <div className={styles.screen}>
        <motion.header
          className={styles.header}
          initial={{ y: -30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={spring}
        >
          <CircleButton tone="gray" size={46} onClick={agent.goBack} aria-label="Назад">
            <BackIcon size={20} />
          </CircleButton>
          <span className={styles.people} role="group" aria-label={`Участники: ресторан, ${FRIEND.name} и вы`}>
            <Stack overlap={10}>
              <RestaurantLogo size={36} />
              <PersonAvatar person={FRIEND} size={36} />
              <MeDot size={36} />
            </Stack>
          </span>
          <span className={styles.headerSpacer} />
        </motion.header>

        <div className={styles.body}>
          <AnimatePresence mode="popLayout" initial={false}>
            {flow.step === 'request' ? (
              <motion.div
                key="request"
                className={`${styles.request} scroll-y`}
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -50, scale: 0.92, transition: { duration: 0.35, ease } }}
                transition={spring}
              >
                <RequestStep
                  prompt={agent.prompt}
                  params={params}
                  auto={!state.autoUsed}
                  onParams={(p) => dispatch({ type: 'params', params: p })}
                  onContinue={() => dispatch({ type: 'search' })}
                  onEditText={agent.editText}
                />
              </motion.div>
            ) : (
              <StepStack key="stack" active={flow.step} onReturn={(step) => dispatch({ type: 'goto', step })}>
                {flow.step === 'timing' && (
                  <TimingStep
                    slot={slot}
                    alternatives={agent.free}
                    when={when}
                    onSelect={(start) => dispatch({ type: 'selectSlot', start })}
                    onBook={() => dispatch({ type: 'find' })}
                  />
                )}
                {flow.step === 'finding' && (
                  <FindingStep
                    phase={flow.phase}
                    places={places}
                    time={slot.start}
                    radiusKm={params.radiusKm}
                    index={state.placeIdx}
                    onIndex={(index) => dispatch({ type: 'placeIdx', index })}
                    onBook={agent.askConfirm}
                    onDetails={() => dispatch({ type: 'openSheet', kind: 'details' })}
                  />
                )}
                {flow.step === 'booking' && (
                  <BookingStep
                    place={flow.place}
                    slot={slot}
                    when={dayLabel(params.dayOffset)}
                    guests={params.guests}
                    invite={params.invite}
                    code={BOOKING_CODE}
                    seconds={flow.seconds}
                    state={flow.call}
                    lines={lines}
                    transcript={flow.transcript}
                    onTranscript={() => dispatch({ type: 'toggleTranscript' })}
                    listening={flow.listening}
                    onHangup={() => dispatch({ type: 'hangup' })}
                    onCancelBooking={() => dispatch({ type: 'cancelBooking' })}
                  />
                )}
              </StepStack>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {(overlay?.kind === 'details' || overlay?.kind === 'reviews') && (
          <PlaceSheet
            key="place"
            place={flow.step === 'booking' ? flow.place : place}
            focus={overlay.kind}
            onClose={() => dispatch({ type: 'closeOverlay' })}
            onBook={flow.step === 'finding' && placeOpen ? () => agent.askConfirm(place) : undefined}
          />
        )}
        {overlay?.kind === 'confirm' && (
          <ConfirmSheet
            key="confirm"
            place={overlay.place}
            slot={slot}
            when={when}
            params={params}
            onParams={(p) => dispatch({ type: 'params', params: p })}
            onConfirm={() => dispatch({ type: 'call', place: overlay.place })}
            onClose={() => dispatch({ type: 'closeOverlay' })}
          />
        )}
      </AnimatePresence>
    </>
  )
}
