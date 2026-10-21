import { Suspense, lazy, type ReactNode } from 'react'
import { useApi } from '../api/provider'
import { useSession } from '../api/session'

// Экран входа нужен один раз на устройство — грузим его, только когда сессии нет.
const AuthScreen = lazy(() => import('../screens/auth/AuthScreen').then((mod) => ({ default: mod.AuthScreen })))

/**
 * В режиме сервера все данные за аккаунтом: без сессии показываем экран входа.
 * Локальный режим (без бэкенда) работает без аккаунта — пропускаем сразу.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const api = useApi()
  const session = useSession()
  if (api.mode === 'server' && !session) {
    return (
      <Suspense fallback={null}>
        <AuthScreen />
      </Suspense>
    )
  }
  return children
}
