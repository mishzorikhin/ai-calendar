import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import { useState } from 'react'
import { apiErrorText } from '../../../api/api'
import { useDeleteIntegration, useSyncIntegration, useUpdateIntegration } from '../../../api/queries'
import {
  ArrowRightIcon,
  BADGE_ICON,
  CalendarIcon,
  LinkIcon,
  LockIcon,
  RefreshIcon,
  TrashIcon,
} from '../../../components/Icons'
import { Pill, Pressable } from '../../../components/ui'
import type { Integration, IntegrationKind } from '../../../domain/types'
import { BADGE_OPTIONS } from '../../../lib/badges'
import { spring } from '../../../lib/motion'
import { KIND_LABEL, syncedLabel } from './labels'
import styles from './Calendars.module.css'

/** Плитка вида календаря: буква сервиса или значок. */
export function KindTile({ kind }: { kind: IntegrationKind }) {
  return (
    <span className={`${styles.tile} ${styles[`tile_${kind}`]}`} aria-hidden="true">
      {kind === 'google' ? (
        'G'
      ) : kind === 'outlook' ? (
        'O'
      ) : kind === 'ics' ? (
        <LinkIcon size={19} />
      ) : (
        <CalendarIcon size={19} />
      )}
    </span>
  )
}

/** Подключённый календарь: статус в строке, настройки — по нажатию. */
export function IntegrationRow({ item, now }: { item: Integration; now: Date }) {
  const [open, setOpen] = useState(false)
  const [sure, setSure] = useState(false)
  const update = useUpdateIntegration()
  const remove = useDeleteIntegration()
  const sync = useSyncIntegration()
  const reduce = useReducedMotion()
  const error = update.error ?? remove.error ?? sync.error
  const detailsId = `calendar-${item.id}`
  const meta = [item.account, syncedLabel(item.lastSync, now)].filter(Boolean).join(' · ')

  return (
    <li className={styles.row}>
      <Pressable
        className={styles.rowHead}
        scale={0.98}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={detailsId}
      >
        <KindTile kind={item.kind} />
        <span className={styles.rowText}>
          <span className={styles.rowName}>
            <span>{item.name}</span>
            {item.primary && <span className={styles.tag}>новые сюда</span>}
          </span>
          <span className={item.lastError ? styles.rowError : styles.rowMeta}>{item.lastError || meta}</span>
        </span>
        <m.span className={styles.chevron} animate={{ rotate: open ? 90 : 0 }} transition={spring}>
          <ArrowRightIcon size={16} strokeWidth={2.2} />
        </m.span>
      </Pressable>

      <AnimatePresence initial={false}>
        {open && (
          <m.div
            id={detailsId}
            className={styles.details}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
          >
            <div className={styles.detailsInner}>
              {item.writable ? (
                <Pressable
                  className={styles.switchRow}
                  scale={0.98}
                  role="switch"
                  aria-checked={item.primary}
                  disabled={update.isPending}
                  onClick={() => update.mutate({ id: item.id, patch: { primary: !item.primary } })}
                >
                  Новые события — сюда
                  <span className={`${styles.switch} ${item.primary ? styles.switchOn : ''}`} aria-hidden="true" />
                </Pressable>
              ) : (
                <p className={styles.readOnlyNote}>
                  <LockIcon size={15} /> {KIND_LABEL[item.kind]} · только просмотр
                </p>
              )}

              <p className={styles.miniLabel} id={`${detailsId}-badge`}>
                Как показывать события
              </p>
              <div className={styles.badges} role="radiogroup" aria-labelledby={`${detailsId}-badge`}>
                {BADGE_OPTIONS.map(({ id, label }) => {
                  const Icon = BADGE_ICON[id]
                  return (
                    <Pill
                      key={id}
                      small
                      role="radio"
                      aria-checked={item.badge === id}
                      tone={item.badge === id ? 'dark' : 'white'}
                      className={styles.badgePill}
                      disabled={update.isPending}
                      onClick={() => item.badge !== id && update.mutate({ id: item.id, patch: { badge: id } })}
                    >
                      <Icon size={14} /> {label}
                    </Pill>
                  )
                })}
              </div>

              <div className={styles.rowActions}>
                <Pill small tone="white" onClick={() => sync.mutate(item.id)} disabled={sync.isPending}>
                  <m.span
                    className={styles.spin}
                    animate={sync.isPending && !reduce ? { rotate: 360 } : { rotate: 0 }}
                    transition={sync.isPending ? { repeat: Infinity, duration: 0.9, ease: 'linear' } : spring}
                  >
                    <RefreshIcon size={15} />
                  </m.span>
                  {sync.isPending ? 'Обновляю…' : 'Обновить'}
                </Pill>
                <Pressable
                  className={`${styles.disconnect} ${sure ? styles.disconnectSure : ''}`}
                  disabled={remove.isPending}
                  onClick={() => (sure ? remove.mutate(item.id) : setSure(true))}
                >
                  <TrashIcon size={16} />
                  {sure ? 'Точно отключить?' : 'Отключить'}
                </Pressable>
              </div>
              {sure && (
                <p className={styles.hint}>
                  События этого календаря пропадут из приложения, в самом календаре они останутся.
                </p>
              )}
              {error && (
                <p className={styles.error} role="alert">
                  {apiErrorText(error)}
                </p>
              )}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </li>
  )
}
