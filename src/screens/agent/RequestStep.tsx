import { AnimatePresence, motion } from 'framer-motion'
import { useState, type ReactNode } from 'react'
import { CalendarIcon, EditIcon, PinIcon, UsersIcon } from '../../components/Icons'
import { PersonAvatar, Pill, Pressable } from '../../components/ui'
import { DAY_OPTIONS, MAX_GUESTS, MIN_GUESTS, RADIUS_OPTIONS, dayLabel, guestsLabel } from '../../domain/request'
import type { RequestParams } from '../../domain/types'
import { useTimeout } from '../../lib/hooks'
import { ease, spring } from '../../lib/motion'
import { FRIEND } from '../../mocks/people'
import styles from './steps.module.css'

const AUTO_SECONDS = 4

type Field = 'day' | 'guests' | 'radius' | 'invite'

/**
 * Запрос и то, что ассистент из него понял. Любой параметр можно поправить;
 * если ничего не трогать, поиск начнётся сам через несколько секунд.
 */
export function RequestStep({
  prompt,
  params,
  auto,
  onParams,
  onContinue,
  onEditText,
}: {
  prompt: string
  params: RequestParams
  /** Автозапуск поиска — только при первом показе, не при возврате назад. */
  auto: boolean
  onParams: (p: RequestParams) => void
  onContinue: () => void
  onEditText: () => void
}) {
  const words = prompt.split(/\s+/).filter(Boolean)
  const [open, setOpen] = useState<Field | null>(null)
  const [paused, setPaused] = useState(!auto)
  const [left, setLeft] = useState(AUTO_SECONDS)
  const revealDelay = 0.15 + words.length * 0.04

  // Обратный отсчёт до автозапуска; первая секунда ждёт, пока проявится текст запроса.
  useTimeout(
    () => (left <= 1 ? onContinue() : setLeft(left - 1)),
    paused ? null : left === AUTO_SECONDS ? 1000 + revealDelay * 1000 : 1000,
    left,
  )

  const toggle = (f: Field) => {
    setPaused(true)
    setOpen((o) => (o === f ? null : f))
  }

  const set = (patch: Partial<RequestParams>) => {
    setPaused(true)
    onParams({ ...params, ...patch })
  }

  return (
    <div className={styles.step}>
      <p className="caption">Ваш запрос</p>
      <h1 className={styles.prompt}>
        {words.map((w, i) => {
          const friend = w.toLowerCase().startsWith(FRIEND.name.toLowerCase())
          const soft = friend || /^(моим|моей|другом|подругой)$/i.test(w)
          return (
            <motion.span
              key={i}
              className={soft ? styles.soft : undefined}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 + i * 0.04, ease }}
            >
              {w}
              {friend && (
                <span className={styles.contact}>
                  <PersonAvatar person={FRIEND} size={28} ring={false} />
                </span>
              )}{' '}
            </motion.span>
          )
        })}
      </h1>

      <motion.div
        className={styles.understood}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: revealDelay }}
      >
        <p className="caption">Я понял так — нажмите, чтобы изменить:</p>
        <div className={styles.paramChips}>
          <ParamChip active={open === 'day'} onClick={() => toggle('day')} icon={<CalendarIcon size={15} />}>
            {dayLabel(params.dayOffset)}
          </ParamChip>
          <ParamChip active={open === 'guests'} onClick={() => toggle('guests')} icon={<UsersIcon size={15} />}>
            {guestsLabel(params.guests)}
          </ParamChip>
          <ParamChip active={open === 'radius'} onClick={() => toggle('radius')} icon={<PinIcon size={15} />}>
            до {params.radiusKm} км
          </ParamChip>
          <ParamChip
            active={open === 'invite'}
            onClick={() => toggle('invite')}
            icon={<PersonAvatar person={FRIEND} size={18} ring={false} />}
          >
            {params.invite ? `Пригласить ${FRIEND.nameAccusative}` : 'Без приглашения'}
          </ParamChip>
        </div>

        <AnimatePresence initial={false} mode="wait">
          {open && (
            <motion.div
              key={open}
              className={styles.options}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease }}
            >
              <div className={styles.optionsRow}>
                {open === 'day' &&
                  DAY_OPTIONS.map((d) => (
                    <Pill
                      key={d.value}
                      small
                      tone={params.dayOffset === d.value ? 'dark' : 'ghost'}
                      aria-pressed={params.dayOffset === d.value}
                      onClick={() => set({ dayOffset: d.value })}
                    >
                      {d.label}
                    </Pill>
                  ))}
                {open === 'guests' &&
                  Array.from({ length: MAX_GUESTS - MIN_GUESTS + 1 }, (_, i) => MIN_GUESTS + i).map((n) => (
                    <Pill
                      key={n}
                      small
                      tone={params.guests === n ? 'dark' : 'ghost'}
                      aria-pressed={params.guests === n}
                      onClick={() => set({ guests: n })}
                      className={styles.square}
                    >
                      {n}
                    </Pill>
                  ))}
                {open === 'radius' &&
                  RADIUS_OPTIONS.map((km) => (
                    <Pill
                      key={km}
                      small
                      tone={params.radiusKm === km ? 'dark' : 'ghost'}
                      aria-pressed={params.radiusKm === km}
                      onClick={() => set({ radiusKm: km })}
                    >
                      до {km} км
                    </Pill>
                  ))}
                {open === 'invite' && (
                  <>
                    <Pill
                      small
                      tone={params.invite ? 'dark' : 'ghost'}
                      aria-pressed={params.invite}
                      onClick={() => set({ invite: true })}
                    >
                      Отправить приглашение
                    </Pill>
                    <Pill
                      small
                      tone={!params.invite ? 'dark' : 'ghost'}
                      aria-pressed={!params.invite}
                      onClick={() => set({ invite: false })}
                    >
                      Не приглашать
                    </Pill>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <div className={styles.cta}>
        <Pill tone="dark" className={`${styles.ctaMain} ${styles.progressBtn}`} onClick={onContinue}>
          {!paused && (
            <motion.i
              className={styles.progress}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: AUTO_SECONDS + revealDelay, ease: 'linear' }}
            />
          )}
          <span>{paused ? 'Искать' : `Искать · ${left} с`}</span>
        </Pill>
        <Pressable className={styles.editText} onClick={onEditText} aria-label="Изменить текст запроса">
          <EditIcon size={20} />
        </Pressable>
      </div>
    </div>
  )
}

function ParamChip({
  children,
  icon,
  active,
  onClick,
}: {
  children: ReactNode
  icon: ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <Pressable
      className={`${styles.paramChip} ${active ? styles.paramChipOn : ''}`}
      onClick={onClick}
      aria-expanded={active}
      scale={0.95}
    >
      {icon}
      {children}
    </Pressable>
  )
}
