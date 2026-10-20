import { useEffect, useEffectEvent } from 'react'
import { useComposer } from '../app/composer'
import { useNavigation } from '../app/navigation'

/**
 * Быстрые действия с иконки приложения (shortcuts в манифесте): ?action=new-event | assistant | month.
 * Выполняются один раз при запуске, затем параметр убирается из адреса.
 */
export function useLaunchAction() {
  const { go } = useNavigation()
  const composer = useComposer()

  const run = useEffectEvent((action: string) => {
    if (action === 'new-event') composer.open()
    else if (action === 'assistant') go('chat')
    else if (action === 'month') go('month')
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
