import { AnimatePresence, m } from 'framer-motion'
import { useAcceptSuggestion, useDismissSuggestion, useSuggestions } from '../../api/queries'
import { useAssistant } from '../../app/assistant'
import { useNavigation } from '../../app/navigation'
import { SuggestIcon } from '../../components/Icons'
import { Pill, Pressable } from '../../components/ui'
import type { Suggestion } from '../../domain/types'
import { spring } from '../../lib/motion'
import styles from './Suggestions.module.css'

/** Подпись «Да»: что именно произойдёт. */
const YES: Record<Suggestion['action']['type'], string> = {
  event: 'Поставить',
  task: 'Добавить задачу',
  chat: 'Обсудить',
}

/**
 * Предложения ассистента на главной: «обед не потеряется?», «задача висит неделю» и т. п.
 * «Да» выполняет действие (у «обсудить» — открывает чат с запросом), «Нет» убирает карточку.
 */
export function SuggestionCards() {
  const { suggestions } = useSuggestions()
  const accept = useAcceptSuggestion()
  const dismiss = useDismissSuggestion()
  const { setPrompt } = useAssistant()
  const { go } = useNavigation()
  const error = accept.error ?? dismiss.error

  const yes = (s: Suggestion) => {
    accept.mutate(
      { id: s.id },
      {
        onSuccess: () => {
          if (s.action.type !== 'chat') return
          setPrompt(s.action.prompt)
          go('chat')
        },
      },
    )
  }

  if (suggestions.length === 0 && !error) return null
  return (
    <section className={styles.list} aria-label="Ассистент предлагает">
      <AnimatePresence initial={false} mode="popLayout">
        {suggestions.map((s) => (
          <m.article
            key={s.id}
            layout
            className={styles.card}
            style={{ borderRadius: 26 }}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.18 } }}
            transition={spring}
          >
            <span className={styles.from}>
              <i className={styles.icon} aria-hidden="true">
                <SuggestIcon size={13} strokeWidth={2.2} />
              </i>
              Ассистент предлагает
            </span>
            <h3 className={styles.title}>{s.title}</h3>
            <p className={styles.body}>{s.body}</p>
            <div className={styles.actions}>
              <Pill tone="dark" small onClick={() => yes(s)}>
                {YES[s.action.type]}
              </Pill>
              <Pill tone="ghost" small onClick={() => dismiss.mutate({ id: s.id })}>
                Нет
              </Pill>
              <Pressable
                className={styles.mute}
                aria-label="Не предлагать такое"
                onClick={() => dismiss.mutate({ id: s.id, mute: true })}
              >
                Не предлагать
              </Pressable>
            </div>
          </m.article>
        ))}
      </AnimatePresence>
      {error && (
        <p className={styles.error} role="status">
          {error.message}
        </p>
      )}
    </section>
  )
}
