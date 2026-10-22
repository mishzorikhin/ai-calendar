import { useEffect, useEffectEvent } from 'react'
import { useAssistant } from '../app/assistant'
import { useComposer } from '../app/composer'
import { useNavigation } from '../app/navigation'
import { TASK_PREFIX } from '../components/VoiceOverlay'
import { speechSupported } from '../lib/speech'

/**
 * Быстрые действия с иконки приложения (shortcuts в манифесте): ?action=new-event | assistant | month | voice-task.
 * Выполняются один раз при запуске, затем параметр убирается из адреса.
 */
export function useLaunchAction() {
  const { go } = useNavigation()
  const composer = useComposer()
  const { setVoice, setDraft } = useAssistant()

  const run = useEffectEvent((action: string) => {
    if (action === 'new-event') composer.open()
    else if (action === 'assistant') go('chat')
    else if (action === 'month') go('month')
    else if (action === 'voice-task') {
      // Без распознавания речи — чат с начатой фразой: задачу допишут с клавиатуры.
      if (speechSupported) setVoice('recording', 'task')
      else {
        setDraft(TASK_PREFIX)
        go('chat')
      }
    }
  })

  useEffect(() => {
    const url = new URL(window.location.href)
    const action = url.searchParams.get('action')
    if (!action) return
    run(action)
    url.searchParams.delete('action')
    window.history.replaceState(null, '', url)
  }, [])
}
