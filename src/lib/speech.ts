import { useCallback, useEffect, useRef, useState } from 'react'

// Минимальная типизация Web Speech API — в lib.dom её ещё нет.
type RecognitionResult = ArrayLike<{ transcript: string }> & { isFinal: boolean }
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> }

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: RecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start(): void
  stop(): void
}

type RecognitionCtor = new () => Recognition

function recognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

/** true, если браузер умеет распознавать речь (Chrome, Safari). */
export const speechSupported = typeof window !== 'undefined' && recognitionCtor() !== undefined

/**
 * Диктовка через Web Speech API.
 * `onResult(final, interim)` — финальные куски и «живой» промежуточный текст.
 */
export function useDictation(onResult: (final: string, interim: string) => void) {
  const [listening, setListening] = useState(false)
  const rec = useRef<Recognition | null>(null)
  const onResultRef = useRef(onResult)
  useEffect(() => {
    onResultRef.current = onResult
  })

  const stop = useCallback(() => rec.current?.stop(), [])

  const start = useCallback(() => {
    const Ctor = recognitionCtor()
    if (!Ctor || rec.current) return
    const r = new Ctor()
    r.lang = 'ru-RU'
    r.continuous = true
    r.interimResults = true
    r.onresult = (e) => {
      let final = ''
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (res?.isFinal) final += res[0]?.transcript ?? ''
        else interim += res?.[0]?.transcript ?? ''
      }
      if (final || interim) onResultRef.current(final, interim)
    }
    r.onend = () => {
      rec.current = null
      setListening(false)
    }
    r.onerror = () => {
      rec.current = null
      setListening(false)
    }
    rec.current = r
    setListening(true)
    try {
      r.start()
    } catch {
      r.onend?.()
    }
  }, [])

  useEffect(() => () => rec.current?.stop(), [])

  return { listening, start, stop, supported: speechSupported }
}
