import { useEffect, useState } from 'react'

/** Событие Chrome/Edge/Android: браузер готов показать системный диалог установки. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
  )
}

/** iPhone/iPad в Safari: установка только вручную через «Поделиться». */
export function isIosSafari(): boolean {
  const ua = navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1)
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
}

export type InstallState =
  | { kind: 'installed' }
  | { kind: 'prompt'; install: () => Promise<boolean> }
  | { kind: 'ios' }
  | { kind: 'unavailable' }

/** Можно ли предложить установку и как именно. */
export function useInstall(): InstallState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (installed) return { kind: 'installed' }
  if (deferred)
    return {
      kind: 'prompt',
      install: async () => {
        await deferred.prompt()
        const { outcome } = await deferred.userChoice
        setDeferred(null)
        return outcome === 'accepted'
      },
    }
  if (isIosSafari()) return { kind: 'ios' }
  return { kind: 'unavailable' }
}
