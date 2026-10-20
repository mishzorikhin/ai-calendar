import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createContext, use, useState, type ReactNode } from 'react'
import { retryQuery, type CalendarApi } from './api'

const ApiContext = createContext<CalendarApi | null>(null)

export function ApiProvider({ api, children }: { api: CalendarApi; children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: api.mode === 'server' ? retryQuery : false,
            // Офлайн запросы ждут сеть, а данные берутся из кэша service worker / памяти.
            networkMode: 'offlineFirst',
          },
          mutations: { networkMode: 'offlineFirst' },
        },
      }),
  )
  return (
    <ApiContext value={api}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ApiContext>
  )
}

export function useApi(): CalendarApi {
  const api = use(ApiContext)
  if (!api) throw new Error('useApi вне ApiProvider')
  return api
}
