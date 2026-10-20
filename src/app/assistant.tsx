import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react'
import type { ChatMessage } from '../domain/types'
import { DEMO_PROMPT } from '../mocks/assistant'

/** idle — микрофон выключен, recording — идёт запись, review — текст распознан и ждёт проверки. */
export type VoiceState = 'idle' | 'recording' | 'review'

type Assistant = {
  /** Запрос, с которым работает экран ассистента. */
  prompt: string
  setPrompt: (p: string) => void
  /** Текст, который откроется в поле чата (например, чтобы поправить запрос). */
  draft: string
  setDraft: (t: string) => void
  messages: readonly ChatMessage[]
  addMessage: (role: ChatMessage['role'], text: string) => void
  voice: VoiceState
  setVoice: (v: VoiceState) => void
}

const AssistantContext = createContext<Assistant | null>(null)

const GREETING: ChatMessage = { id: 0, role: 'ai', text: 'Чем могу помочь?' }

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState(DEMO_PROMPT)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<readonly ChatMessage[]>([GREETING])
  const [voice, setVoice] = useState<VoiceState>('idle')

  const addMessage = useCallback((role: ChatMessage['role'], text: string) => {
    setMessages((list) => [...list, { id: (list.at(-1)?.id ?? 0) + 1, role, text }])
  }, [])

  const value = useMemo<Assistant>(
    () => ({ prompt, setPrompt, draft, setDraft, messages, addMessage, voice, setVoice }),
    [prompt, draft, messages, addMessage, voice],
  )
  return <AssistantContext value={value}>{children}</AssistantContext>
}

export function useAssistant(): Assistant {
  const ctx = use(AssistantContext)
  if (!ctx) throw new Error('useAssistant вне AssistantProvider')
  return ctx
}
