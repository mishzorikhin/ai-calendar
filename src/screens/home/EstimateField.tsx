import { Pill } from '../../components/ui'
import styles from './Home.module.css'

const OPTIONS = [
  { minutes: 15, label: '15 мин' },
  { minutes: 30, label: '30 мин' },
  { minutes: 60, label: '1 ч' },
  { minutes: 120, label: '2 ч' },
  { minutes: 240, label: '4 ч' },
] as const

/** «Сколько займёт»: по этой оценке ассистент раскладывает задачи по окнам. 0 — не указано (час). */
export function EstimateField({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  return (
    <>
      <p className={styles.sheetLabel} id="estimate-label">
        Сколько займёт
      </p>
      <div className={styles.tagRow} role="group" aria-labelledby="estimate-label">
        {OPTIONS.map(({ minutes, label }) => (
          <Pill
            key={minutes}
            small
            tone={value === minutes ? 'dark' : 'ghost'}
            aria-pressed={value === minutes}
            onClick={() => onChange(value === minutes ? 0 : minutes)}
          >
            {label}
          </Pill>
        ))}
      </div>
    </>
  )
}
