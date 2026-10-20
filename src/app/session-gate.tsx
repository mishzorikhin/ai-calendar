import type { ReactNode } from 'react'
import { useApi } from '../api/provider'
import { useSession } from '../api/session'
import { AuthScreen } from '../screens/auth/AuthScreen'

/**
 * В режиме сервера все данные за аккаунтом: без сессии показываем экран входа.
 * Локальный режим (без бэкенда) работает без аккаунта — пропускаем сразу.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const api = useApi()
  const session = useSession()
  if (api.mode === 'server' && !session) return <AuthScreen />
  return children
}
