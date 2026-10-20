import { motion, useDragControls, type PanInfo } from 'framer-motion'
import { CalendarIcon, CloseIcon, MinusIcon, PinIcon, PlusIcon, UsersIcon } from '../../components/Icons'
import { Avatar, CircleButton, Pill, Pressable, SmartImage } from '../../components/ui'
import { FRIEND, guestsLabel, type RequestParams, type Restaurant, type Slot } from '../../data'
import { formatMinutes } from '../../lib/dates'
import { softSpring, spring } from '../../lib/motion'
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
  const drag = useDragControls()
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 600) onClose()
  }

  return (
    <motion.div className={styles.root} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className={styles.backdrop} onClick={onClose} />
      <motion.div
        className={styles.sheet}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%', transition: { duration: 0.28 } }}
        transition={softSpring}
        drag="y"
        dragControls={drag}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.05, bottom: 0.8 }}
        onDragEnd={onDragEnd}
        role="dialog"
        aria-label="Подтверждение брони"
      >
        <div className={styles.handleZone} onPointerDown={(e) => drag.start(e)}>
          <i />
        </div>
        <div className={styles.head}>
          <h2>Проверьте бронь</h2>
          <CircleButton tone="gray" size={40} onClick={onClose} aria-label="Закрыть">
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
              <b>{guestsLabel(params.guests)}</b>
              <small>Столик на всех гостей</small>
            </span>
            <span className={styles.stepper}>
              <Pressable
                className={styles.stepBtn}
                onClick={() => onParams({ ...params, guests: Math.max(1, params.guests - 1) })}
                disabled={params.guests <= 1}
                aria-label="Меньше гостей"
              >
                <MinusIcon size={16} />
              </Pressable>
              <Pressable
                className={styles.stepBtn}
                onClick={() => onParams({ ...params, guests: Math.min(8, params.guests + 1) })}
                aria-label="Больше гостей"
              >
                <PlusIcon size={16} />
              </Pressable>
            </span>
          </li>
          <li>
            <Avatar initials={FRIEND.initials} src={FRIEND.photo} size={22} ring={false} color="#dfe2f7" />
            <span className={styles.rowText}>
              <b>Пригласить Глеба</b>
              <small>{params.invite ? 'Отправлю приглашение после брони' : 'Глеб не получит приглашение'}</small>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={params.invite}
              aria-label="Пригласить Глеба"
              className={`${styles.switch} ${params.invite ? styles.switchOn : ''}`}
              onClick={() => onParams({ ...params, invite: !params.invite })}
            >
              <motion.i layout transition={spring} />
            </button>
          </li>
        </ul>

        <p className={styles.note}>
          Я позвоню в ресторан от вашего имени и передам ваше имя и номер телефона. Звонок можно прервать в любой
          момент.
        </p>

        <div className={styles.actions}>
          <Pill tone="dark" className={styles.confirm} onClick={onConfirm}>
            Позвонить и забронировать
          </Pill>
          <Pill tone="ghost" className={styles.cancel} onClick={onClose}>
            Отмена
          </Pill>
        </div>
      </motion.div>
    </motion.div>
  )
}
