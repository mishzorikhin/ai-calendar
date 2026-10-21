import { AnimatePresence, m } from 'framer-motion'
import { useState } from 'react'
import { ChevronDownIcon } from '../../../components/Icons'
import { Pressable } from '../../../components/ui'
import { REMINDER_PRESETS, reminderShortLabel } from '../../../domain/reminders'
import type { Badge, NotifySettings } from '../../../domain/types'
import { BADGE_OPTIONS } from '../../../lib/badges'
import { spring } from '../../../lib/motion'
import { ChoiceRow } from './ChoiceRow'
import styles from './Reminders.module.css'

/** −2 — «как обычно»: у типа нет своего значения. */
const AS_USUAL = -2
const CHOICES = [AS_USUAL, -1, ...REMINDER_PRESETS]
const label = (mins: number) => (mins === AS_USUAL ? 'Как обычно' : reminderShortLabel(mins))

/** «Своё время для типов событий»: спорт — за час, работа — за 15 минут… */
export function BadgeDefaults({
  settings,
  onChange,
}: {
  settings: NotifySettings
  onChange: (badgeReminders: Partial<Record<Badge, number>>) => void
}) {
  const own = settings.badgeReminders ?? {}
  const [open, setOpen] = useState(Object.keys(own).length > 0)

  const set = (badge: Badge, minutes: number) => {
    const next = { ...own }
    if (minutes === AS_USUAL) delete next[badge]
    else next[badge] = minutes
    onChange(next)
  }

  return (
    <div className={styles.badgeDefaults}>
      <Pressable className={styles.disclosure} scale={0.98} aria-expanded={open} onClick={() => setOpen(!open)}>
        Своё время для типов событий
        <ChevronDownIcon size={16} className={open ? styles.chevronOpen : styles.chevron} />
      </Pressable>
      <AnimatePresence initial={false}>
        {open && (
          <m.div
            className={styles.disclosureBody}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
          >
            {BADGE_OPTIONS.map(({ id, label: name }) => (
              <ChoiceRow
                key={id}
                title={name}
                options={CHOICES}
                value={own[id] ?? AS_USUAL}
                label={label}
                onChange={(mins) => set(id, mins)}
                compact
              />
            ))}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}
