import { createContext, use, useMemo, useState, type ReactNode } from 'react'

/** idle — микрофон выключен, recording — идёт запись, review — текст распознан и ждёт проверки. */
export type VoiceState = 'idle' | 'recording' | 'review'

/** Состояние ассистента в интерфейсе. История чата — в api/queries (useMessages). */
type Assistant = {
  /** Текст, который чат отправит сразу при открытии (голосовой ввод, «поручить ассистенту»). */
  prompt: string
  setPrompt: (p: string) => void
  /** Текст, который откроется в поле чата (например, чтобы поправить запрос). */
  draft: string
  setDraft: (t: string) => void
  voice: VoiceState
  setVoice: (v: VoiceState) => void
}

const AssistantContext = createContext<Assistant | null>(null)

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState('')
  const [draft, setDraft] = useState('')
  const [voice, setVoice] = useState<VoiceState>('idle')
  const value = useMemo<Assistant>(
    () => ({ prompt, setPrompt, draft, setDraft, voice, setVoice }),
    [prompt, draft, voice],
  )
  return <AssistantContext value={value}>{children}</AssistantContext>
}

export function useAssistant(): Assistant {
  const ctx = use(AssistantContext)
  if (!ctx) throw new Error('useAssistant вне AssistantProvider')
  return ctx
}
