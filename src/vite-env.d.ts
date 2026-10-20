/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />
/// <reference types="vite-plugin-pwa/info" />

interface ImportMetaEnv {
  /** local — без сервера, server — только сервер; по умолчанию определяется автоматически. */
  readonly VITE_API_MODE?: 'local' | 'server'
  /** Адрес бэкенда, если он не на том же домене. */
  readonly VITE_API_URL?: string
}
