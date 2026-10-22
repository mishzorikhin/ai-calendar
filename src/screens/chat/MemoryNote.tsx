import { m } from 'framer-motion'
import type { MemoryChange } from '../../api/api'
import { useNavigation } from '../../app/navigation'
import { requestHomeSheet } from '../../app/sheetRequest'
import { BrainIcon } from '../../components/Icons'
import { Pressable } from '../../components/ui'
import { spring } from '../../lib/motion'
import styles from './Chat.module.css'

const VERB: Record<MemoryChange['action'], string> = { added: 'Запомнил', updated: 'Обновил', deleted: 'Забыл' }

/**
 * Пометка под ответом: что ассистент сохранил в память за этот ход. Её шлёт сервер после
 * настоящей записи — если пометки нет, ничего не сохранилось. Нажатие — список «Что ассистент знает».
 */
export function MemoryNote({ items }: { items: readonly MemoryChange[] }) {
  const { reset } = useNavigation()
  if (items.length === 0) return null
  return (
    <m.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <Pressable
        className={styles.memoryNote}
        scale={0.97}
        onClick={() => {
          requestHomeSheet('memory')
          reset('home')
        }}
        aria-label="Открыть «Что ассистент знает»"
      >
        <BrainIcon size={14} />
        <span>
          {items.map((it, i) => (
            <span key={i} className={styles.memoryLine}>
              {VERB[it.action]}: {it.text}
            </span>
          ))}
        </span>
      </Pressable>
    </m.div>
  )
}
