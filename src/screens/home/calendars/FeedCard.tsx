import { useState } from 'react'
import { apiErrorText } from '../../../api/api'
import { useFeed } from '../../../api/queries'
import { CopyIcon } from '../../../components/Icons'
import { Pill, Pressable } from '../../../components/ui'
import { useTimeout } from '../../../lib/hooks'
import styles from './Calendars.module.css'

/** Ссылка на ленту .ics: события приложения видны в Google, Apple и Outlook. */
export function FeedCard() {
  const { url, isLoading, reset, disable } = useFeed()
  const [copied, setCopied] = useState(false)
  const [sureReset, setSureReset] = useState(false)
  useTimeout(() => setCopied(false), copied ? 2000 : null)
  const error = reset.error ?? disable.error

  const copy = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      /* без доступа к буферу — ссылку можно выделить в поле */
    }
  }

  return (
    <div className={styles.feed}>
      {url ? (
        <>
          <p className={styles.feedText}>
            Добавьте ссылку в другой календарь — там появятся события, созданные здесь. В Google: «Другие календари» →
            «+» → «По URL».
          </p>
          <input
            className={styles.feedUrl}
            value={url}
            readOnly
            aria-label="Ссылка на календарь"
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className={styles.feedActions}>
            <Pill small tone="dark" onClick={() => void copy()}>
              <CopyIcon size={15} /> {copied ? 'Скопировано' : 'Скопировать'}
            </Pill>
            <a className={styles.feedLink} href={url.replace(/^https?:/, 'webcal:')}>
              Открыть в Календаре Apple
            </a>
          </div>
          <div className={styles.feedMinor}>
            <Pressable
              className={styles.textBtn}
              disabled={reset.isPending}
              onClick={() => {
                if (!sureReset) {
                  setSureReset(true)
                  return
                }
                setSureReset(false)
                reset.mutate()
              }}
            >
              {sureReset ? 'Старая ссылка перестанет работать — продолжить?' : 'Новая ссылка'}
            </Pressable>
            {!sureReset && (
              <Pressable
                className={`${styles.textBtn} ${styles.textBtnDanger}`}
                disabled={disable.isPending}
                onClick={() => disable.mutate()}
              >
                Выключить
              </Pressable>
            )}
          </div>
        </>
      ) : (
        <>
          <p className={styles.feedText}>
            Личная ссылка, по которой Google, Apple или Outlook покажут ваши события отсюда. Ссылка секретная — не
            публикуйте её.
          </p>
          <div className={styles.feedActions}>
            <Pill small tone="dark" onClick={() => reset.mutate()} disabled={isLoading || reset.isPending}>
              {reset.isPending ? 'Создаю…' : 'Создать ссылку'}
            </Pill>
          </div>
        </>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {apiErrorText(error)}
        </p>
      )}
    </div>
  )
}
