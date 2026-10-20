/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { viteSingleFile } from 'vite-plugin-singlefile'

const manifest = {
  id: '/',
  name: 'AI Календарь',
  short_name: 'Календарь',
  description: 'Планирование дня, встреч и бронирований одной фразой.',
  lang: 'ru',
  dir: 'ltr' as const,
  start_url: './',
  scope: './',
  display: 'standalone' as const,
  display_override: ['standalone' as const, 'minimal-ui' as const],
  orientation: 'portrait' as const,
  background_color: '#f3f2f5',
  theme_color: '#f3f2f5',
  categories: ['productivity', 'lifestyle'],
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' as const },
    { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
  ],
  // Быстрые действия по долгому нажатию на иконку (Android, десктоп).
  shortcuts: [
    {
      name: 'Новое событие',
      short_name: 'Событие',
      url: './?action=new-event',
      icons: [{ src: 'icon-192.png', sizes: '192x192' }],
    },
    {
      name: 'Ассистент',
      short_name: 'Ассистент',
      url: './?action=assistant',
      icons: [{ src: 'icon-192.png', sizes: '192x192' }],
    },
    {
      name: 'Календарь на месяц',
      short_name: 'Месяц',
      url: './?action=month',
      icons: [{ src: 'icon-192.png', sizes: '192x192' }],
    },
  ],
}

// `--mode single` собирает всё приложение в один index.html (превью без сервера и без service worker).
export default defineConfig(({ mode }) => {
  const single = mode === 'single'
  return {
    base: './',
    define: single ? { 'import.meta.env.VITE_API_MODE': JSON.stringify('local') } : {},
    // Без плагина PWA (однофайловая сборка) регистрация service worker заменяется заглушкой.
    resolve: single
      ? { alias: { 'virtual:pwa-register/react': new URL('./src/pwa/registerStub.ts', import.meta.url).pathname } }
      : undefined,
    plugins: [
      react(),
      single
        ? viteSingleFile()
        : VitePWA({
            registerType: 'prompt',
            injectRegister: false,
            includeAssets: ['icon.svg', 'apple-touch-icon.png'],
            manifest,
            // Свой service worker (src/sw.ts): тот же precache/роутинг, плюс replay
            // офлайн-очереди мутаций по Background Sync.
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.ts',
            injectManifest: {
              globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
              // Греческие и вьетнамские начертания шрифта в интерфейсе не нужны — не кладём их в офлайн-кэш.
              globIgnores: ['**/inter-{greek,greek-ext,vietnamese}-*'],
            },
          }),
    ],
    server: {
      // В разработке API проксируется на Go-сервер (cd server && go run ./cmd/server).
      proxy: { '/api': 'http://localhost:8080' },
    },
    build: {
      outDir: single ? 'dist-single' : 'dist',
      // Библиотеки отдельно от кода приложения: при обновлениях приложения кэш библиотек остаётся.
      rolldownOptions: single
        ? undefined
        : {
            output: {
              advancedChunks: {
                groups: [
                  { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
                  { name: 'motion', test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/ },
                  { name: 'query', test: /node_modules[\\/]@tanstack[\\/]/ },
                ],
              },
            },
          },
    },
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  }
})
