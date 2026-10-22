import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useAssistant, type VoiceMode } from '../app/assistant'
import { useNavigation } from '../app/navigation'
import { softSpring, spring } from '../lib/motion'
import { speechSupported, useDictation } from '../lib/speech'
import { Pill } from './ui'
import styles from './VoiceOverlay.module.css'

/**
 * Голосовой ввод через Web Speech API: распознавание идёт вживую,
 * затем пользователь проверяет текст и отправляет или правит его.
 * В браузерах без SpeechRecognition оверлей не показывается — кнопки запуска скрыты.
 */
/** Запрос ассистенту из надиктованного: для задачи — с явной просьбой её добавить. */
export const voiceRequest = (heard: string, mode: VoiceMode) => (mode === 'task' ? `${TASK_PREFIX}${heard}` : heard)
export const TASK_PREFIX = 'Добавь задачу: '

export function VoiceOverlay() {
  if (!speechSupported) return null
  return <VoiceOverlayInner />
}

function VoiceOverlayInner() {
  const { voice, setVoice, voiceMode, setPrompt, setDraft } = useAssistant()
  const { route, go } = useNavigation()
  const visible = voice !== 'idle' && route !== 'chat'
  const [text, setText] = useState('')
  const [interim, setInterim] = useState('')
  const still = useReducedMotion()

  const { start, stop } = useDictation((final, inter) => {
    setInterim(inter)
    if (final) setText((t) => (t ? `${t} ${final.trim()}` : final.trim()))
  })

  // Новая сессия диктовки — очищаем прошлый текст при смене состояния.
  const [prevVoice, setPrevVoice] = useState(voice)
  if (voice !== prevVoice) {
    setPrevVoice(voice)
    if (voice === 'recording') {
      setText('')
      setInterim('')
    }
  }

  // Состояние ассистента управляет распознаванием: recording → старт, остальное → стоп.
  useEffect(() => {
    if (voice === 'recording') start()
    else stop()
  }, [voice, start, stop])

  const heard = [text, interim].filter(Boolean).join(' ')

  return (
    <AnimatePresence>
      {visible && (
        <m.div
          key="voice"
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
          onClick={() => setVoice('idle')}
        >
          <m.div
            className={styles.panel}
            role="dialog"
            aria-label="Голосовой ввод"
            initial={{ y: 40, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={softSpring}
            onClick={(e) => e.stopPropagation()}
          >
            <span className={styles.label} aria-live="polite">
              {voice === 'recording' && (
                <m.i
                  animate={still ? undefined : { scale: [1, 1.5, 1], opacity: [1, 0.4, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                />
              )}
              {voice === 'recording' ? (heard ? 'Распознаю речь' : 'Слушаю…') : 'Проверьте, правильно ли я понял'}
            </span>
            <p className={styles.text}>
              {text && `${text} `}
              {interim && <span className={styles.placeholder}>{interim}</span>}
              {!heard && (
                <span className={styles.placeholder}>
                  {voiceMode === 'task'
                    ? 'Скажите задачу — например, «купить подарок маме до пятницы»'
                    : 'Скажите, что нужно запланировать'}
                </span>
              )}
            </p>
            <AnimatePresence initial={false} mode="wait">
              {voice === 'review' ? (
                <m.div
                  key="actions"
                  className={styles.actions}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={spring}
                >
                  <Pill
                    tone="dark"
                    className={styles.send}
                    disabled={!heard}
                    onClick={() => {
                      setPrompt(voiceRequest(heard, voiceMode))
                      setVoice('idle')
                      go('chat')
                    }}
                  >
                    Отправить
                  </Pill>
                  <Pill
                    tone="ghost"
                    onClick={() => {
                      setDraft(voiceRequest(heard, voiceMode))
                      setVoice('idle')
                      go('chat')
                    }}
                  >
                    Исправить
                  </Pill>
                  <Pill tone="ghost" onClick={() => setVoice('idle')}>
                    Отмена
                  </Pill>
                </m.div>
              ) : (
                <m.div key="stop" className={styles.actions} exit={{ opacity: 0 }}>
                  <Pill tone="dark" small onClick={() => setVoice('review')}>
                    Готово
                  </Pill>
                  <Pill tone="ghost" small onClick={() => setVoice('idle')}>
                    Отмена
                  </Pill>
                </m.div>
              )}
            </AnimatePresence>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  )
}
