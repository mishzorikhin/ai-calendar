import './styles/fonts.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { connectApi } from './api/connect'
import { App } from './App'
import { applyTheme } from './lib/theme'
import './styles/global.css'

// Тема — до первого кадра: выбор этого устройства из localStorage.
applyTheme()

const root = createRoot(document.getElementById('root')!)

// Сначала выбираем источник данных (сервер или локальный режим), затем рисуем приложение.
void connectApi().then((api) => {
  if (import.meta.env.DEV) console.info(`[ai-calendar] источник данных: ${api.mode}`)
  root.render(
    <StrictMode>
      <App api={api} />
    </StrictMode>,
  )
})
