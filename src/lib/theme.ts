import { useSyncExternalStore } from 'react'
import { readText, writeText } from './storage'

/** Оформление: как в системе, всегда светлое или всегда тёмное. Настройка этого устройства. */
export type ThemeChoice = 'system' | 'light' | 'dark'

const KEY = 'ai-calendar:theme'
/** Цвет панели браузера и фона под приложением — совпадает с --bg. */
const BG = { light: '#f3f2f5', dark: '#0c0c10' } as const

const listeners = new Set<() => void>()

export function isThemeChoice(v: unknown): v is ThemeChoice {
  return v === 'system' || v === 'light' || v === 'dark'
}

export function readTheme(): ThemeChoice {
  const v = readText(KEY)
  return isThemeChoice(v) ? v : 'system'
}

function systemDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Тема, которая видна сейчас: выбор пользователя или настройка системы. */
export function resolvedTheme(choice: ThemeChoice = readTheme()): 'light' | 'dark' {
  if (choice !== 'system') return choice
  return systemDark() ? 'dark' : 'light'
}

/**
 * Применяет выбор к документу: data-theme на <html> фиксирует color-scheme (см. global.css),
 * «как в системе» — без атрибута. Цвет панели браузера (theme-color) следует видимой теме.
 */
export function applyTheme(choice: ThemeChoice = readTheme()): void {
  const root = document.documentElement
  if (choice === 'system') delete root.dataset.theme
  else root.dataset.theme = choice
  const color = BG[resolvedTheme(choice)]
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    // Явный выбор перекрывает оба варианта (light/dark по media); «как в системе» — возвращаем исходные.
    meta.content = choice === 'system' ? (meta.dataset.default ?? meta.content) : color
  }
}

export function setTheme(choice: ThemeChoice): void {
  writeText(KEY, choice === 'system' ? null : choice)
  applyTheme(choice)
  for (const l of listeners) l()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Текущий выбор оформления и его смена. */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore(subscribe, readTheme, () => 'system' as const)
  return [choice, setTheme]
}
