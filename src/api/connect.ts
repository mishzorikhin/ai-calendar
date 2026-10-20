import { readFlag, writeFlag } from '../lib/storage'
import type { CalendarApi } from './api'
import { createHttpApi, probeServer } from './http'
import { createLocalApi } from './local'
import { withOfflineQueue } from './offline'

const SERVER_KEY = 'ai-calendar:server'

/**
 * Выбор источника данных при запуске:
 * VITE_API_MODE=local|server задаёт режим явно, иначе — сервер, если он отвечает на /api/health.
 * Если приложение уже работало с сервером, а сейчас он недоступен (нет сети), остаёмся в режиме
 * сервера: данные придут из кэша service worker, а не подменятся демо-данными.
 */
export async function connectApi(): Promise<CalendarApi> {
  const mode = import.meta.env.VITE_API_MODE
  const base = import.meta.env.VITE_API_URL ?? ''
  // Серверный API оборачиваем офлайн-очередью: без сети мутации ждут в IndexedDB и повторяются.
  if (mode === 'local') return createLocalApi()
  if (mode === 'server') return withOfflineQueue(createHttpApi(base), base)
  if (await probeServer(base)) {
    writeFlag(SERVER_KEY)
    return withOfflineQueue(createHttpApi(base), base)
  }
  return readFlag(SERVER_KEY) ? withOfflineQueue(createHttpApi(base), base) : createLocalApi()
}
