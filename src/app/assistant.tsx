import { createContext, use, useMemo, useState, type ReactNode } from 'react'

/** idle — микрофон выключен, recording — идёт запись, review — текст распознан и ждёт проверки. */
export type VoiceState = 'idle' | 'recording' | 'review'

/** О чём диктовка: any — любой запрос, task — новая задача (ярлык «Задача голосом»). */
export type VoiceMode = 'any' | 'task'

/** Состояние ассистента в интерфейсе. История чата — в api/queries (useMessages). */
type Assistant = {
  /** Текст, который чат отправит сразу при открытии (голосовой ввод, «поручить ассистенту»). */
  prompt: string
  setPrompt: (p: string) => void
  /** Текст, который откроется в поле чата (например, чтобы поправить запрос). */
  draft: string
  setDraft: (t: string) => void
  voice: VoiceState
  /** Сменить состояние диктовки; mode задаётся при старте, по умолчанию — любой запрос. */
  setVoice: (v: VoiceState, mode?: VoiceMode) => void
  voiceMode: VoiceMode
}

const AssistantContext = createContext<Assistant | null>(null)

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState('')
  const [draft, setDraft] = useState('')
  const [voice, setVoiceState] = useState<VoiceState>('idle')
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('any')
  const value = useMemo<Assistant>(() => {
    const setVoice = (v: VoiceState, mode?: VoiceMode) => {
      setVoiceState(v)
      if (v === 'recording') setVoiceMode(mode ?? 'any')
    }
    return { prompt, setPrompt, draft, setDraft, voice, setVoice, voiceMode }
  }, [prompt, draft, voice, voiceMode])
  return <AssistantContext value={value}>{children}</AssistantContext>
}

export function useAssistant(): Assistant {
  const ctx = use(AssistantContext)
  if (!ctx) throw new Error('useAssistant вне AssistantProvider')
  return ctx
}
