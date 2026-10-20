import { motion } from 'framer-motion'
import { BottomSheet } from '../../components/BottomSheet'
import { CalendarIcon, CloseIcon, MinusIcon, PinIcon, PlusIcon, UsersIcon } from '../../components/Icons'
import { CircleButton, Pill, PersonAvatar, Pressable, SmartImage } from '../../components/ui'
import { MAX_GUESTS, MIN_GUESTS, clampGuests, guestsLabel } from '../../domain/request'
import type { RequestParams, Restaurant, Slot } from '../../domain/types'
import { formatMinutes } from '../../lib/dates'
import { spring } from '../../lib/motion'
import { FRIEND } from '../../mocks/people'
import styles from './ConfirmSheet.module.css'

/**
 * Последняя проверка перед звонком: ассистент ничего не делает от имени пользователя,
 * пока тот не увидит все детали брони и не подтвердит их.
 */
export function ConfirmSheet({
  place,
  slot,
  when,
  params,
  onParams,
  onConfirm,
  onClose,
}: {
  place: Restaurant
  slot: Slot
  when: string
  params: RequestParams
  onParams: (p: RequestParams) => void
  onConfirm: () => void
  onClose: () => void
}) {
  const setGuests = (n: number) => onParams({ ...params, guests: clampGuests(n) })

  return (
    <BottomSheet
      label="Подтверждение брони"
      onClose={onClose}
      maxHeight="94%"
      footer={
        <div className={styles.actions}>
          <Pill tone="dark" className={styles.confirm} onClick={onConfirm}>
            Позвонить и забронировать
          </Pill>
          <Pill tone="ghost" className={styles.confirm} onClick={onClose}>
            Отмена
          </Pill>
        </div>
      }
    >
      <div className={styles.head}>
        <h2>Проверьте бронь</h2>
        <CircleButton tone="gray" size={44} onClick={onClose} aria-label="Закрыть">
          <CloseIcon size={18} />
        </CircleButton>
      </div>

      <div className={styles.place}>
        <SmartImage src={place.photo} art={place.art} className={styles.thumb} />
        <div>
          <b>{place.name}</b>
          <span>
            <PinIcon size={13} /> {place.address} · {place.distance}
          </span>
        </div>
      </div>

      <ul className={styles.rows}>
        <li>
          <CalendarIcon size={18} />
          <span className={styles.rowText}>
            <b className="tnum">
              {when}, {formatMinutes(slot.start)}–{formatMinutes(slot.end)}
            </b>
            <small>Добавлю в ваш календарь</small>
          </span>
        </li>
        <li>
          <UsersIcon size={18} />
          <span className={styles.rowText}>
            <b aria-live="polite">{guestsLabel(params.guests)}</b>
            <small>Столик на всех гостей</small>
          </span>
          <span className={styles.stepper}>
            <Pressable
              className={styles.stepBtn}
              onClick={() => setGuests(params.guests - 1)}
              disabled={params.guests <= MIN_GUESTS}
              aria-label="Меньше гостей"
            >
              <MinusIcon size={16} />
            </Pressable>
            <Pressable
              className={styles.stepBtn}
              onClick={() => setGuests(params.guests + 1)}
              disabled={params.guests >= MAX_GUESTS}
              aria-label="Больше гостей"
            >
              <PlusIcon size={16} />
            </Pressable>
          </span>
        </li>
        <li>
          <PersonAvatar person={FRIEND} size={22} ring={false} />
          <span className={styles.rowText}>
            <b>Пригласить {FRIEND.nameAccusative}</b>
            <small>
              {params.invite ? 'Отправлю приглашение после брони' : `${FRIEND.name} не получит приглашение`}
            </small>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={params.invite}
            aria-label={`Пригласить ${FRIEND.nameAccusative}`}
            className={`${styles.switch} ${params.invite ? styles.switchOn : ''}`}
            onClick={() => onParams({ ...params, invite: !params.invite })}
          >
            <motion.i layout transition={spring} />
          </button>
        </li>
      </ul>

      <p className={styles.note}>
        Я позвоню в ресторан от вашего имени и передам ваше имя и номер телефона. Звонок можно прервать в любой момент.
      </p>
    </BottomSheet>
  )
}
