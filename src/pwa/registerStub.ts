import { useState } from 'react'

/** Заглушка `virtual:pwa-register/react` для сборки без service worker (`--mode single`). */
export function useRegisterSW() {
  const needRefresh = useState(false)
  const offlineReady = useState(false)
  return { needRefresh, offlineReady, updateServiceWorker: async () => {} }
}
