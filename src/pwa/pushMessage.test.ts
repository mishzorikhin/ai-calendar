import { describe, expect, it } from 'vitest'
import { notificationActions, notificationOptions, parsePushMessage, showInApp, snoozedMessage } from './pushMessage'

describe('уведомление из push', () => {
  it('разбирает сообщение сервера', () => {
    const msg = parsePushMessage({
      kind: 'task',
      title: 'Отчёт',
      body: 'Срок сегодня',
      url: '/#home',
      tag: 'task:tsk-1',
      taskId: 'tsk-1',
    })
    expect(msg).toEqual({
      kind: 'task',
      title: 'Отчёт',
      body: 'Срок сегодня',
      url: '/#home',
      tag: 'task:tsk-1',
      taskId: 'tsk-1',
    })
    expect(notificationOptions(msg)).toMatchObject({ body: 'Срок сегодня', tag: 'task:tsk-1', data: msg })
  })

  it('вибрация и повторный сигнал', () => {
    const now = notificationOptions(
      parsePushMessage({ kind: 'event', title: 'x', body: 'Сейчас · 10:00–11:00', tag: 'event:1' }),
    )
    expect(now).toMatchObject({ vibrate: [200, 100, 200, 100, 200], renotify: true, requireInteraction: true })
    const soon = notificationOptions(
      parsePushMessage({ kind: 'event', title: 'x', body: 'Через 10 минут', tag: 'event:1' }),
    )
    expect(soon.requireInteraction).toBe(false)
    // Без тега renotify браузер не принимает.
    const untagged = notificationOptions(parsePushMessage({ kind: 'digest', title: 'x' }))
    expect(untagged).toMatchObject({ vibrate: [120], renotify: false })
  })

  it('битое сообщение всё равно показывается, чужие адреса не открываются', () => {
    expect(parsePushMessage(null)).toEqual({ kind: 'test', title: 'AI Календарь', url: '/' })
    expect(parsePushMessage({ kind: 'spam', title: 5, url: 'https://evil.example' })).toMatchObject({
      kind: 'test',
      title: 'AI Календарь',
      url: '/',
    })
    expect(parsePushMessage({ title: 'x', url: '//evil.example/path' }).url).toBe('/')
  })

  it('кнопки зависят от вида уведомления', () => {
    expect(notificationActions(parsePushMessage({ kind: 'event', title: 'x' })).map((a) => a.action)).toEqual([
      'snooze',
    ])
    expect(
      notificationActions(parsePushMessage({ kind: 'task', title: 'x', taskId: 't1' })).map((a) => a.action),
    ).toEqual(['done', 'snooze'])
    expect(notificationActions(parsePushMessage({ kind: 'task', title: 'x' })).map((a) => a.action)).toEqual(['snooze'])
    expect(notificationActions(parsePushMessage({ kind: 'digest', title: 'x' }))).toEqual([])
  })

  it('отложенная встреча теряет устаревшее «через 10 минут»', () => {
    const msg = parsePushMessage({ kind: 'event', title: 'Звонок', body: 'Через 10 минут · 10:00–11:00 · Zoom' })
    expect(snoozedMessage(msg).body).toBe('Отложенное напоминание · 10:00–11:00 · Zoom')
    const task = parsePushMessage({ kind: 'task', title: 'Отчёт', body: 'Срок сегодня' })
    expect(snoozedMessage(task)).toBe(task)
  })

  it('своё напоминание и число на иконке', () => {
    const msg = parsePushMessage({ kind: 'reminder', title: 'Позвонить маме', badge: 3, tag: 'reminder:ab' })
    expect(msg.kind).toBe('reminder')
    expect(msg.badge).toBe(3)
    expect(notificationActions(msg).map((a) => a.action)).toEqual(['snooze'])
    expect(notificationOptions(msg).requireInteraction).toBe(true)
    expect(parsePushMessage({ title: 'x', badge: -1 }).badge).toBeUndefined()
    expect(parsePushMessage({ title: 'x', badge: 1.5 }).badge).toBeUndefined()
  })

  it('в открытом приложении — плашка только в Chromium вне iOS', () => {
    const FCM = 'https://fcm.googleapis.com/fcm/send/abc'
    const chromeAndroid =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
    const safariMac =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
    const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'
    expect(showInApp(chromeAndroid, FCM)).toBe(true)
    expect(showInApp(firefox, FCM)).toBe(false)
    // Подписка у Apple — никогда, даже если User-Agent похож на Chrome на Mac (iPad).
    expect(showInApp(chromeAndroid, 'https://web.push.apple.com/QGx')).toBe(false)
    expect(showInApp(chromeAndroid, undefined)).toBe(false)
    expect(showInApp(safariMac, FCM)).toBe(false)
    expect(showInApp(iphone, FCM)).toBe(false)
    // PWA на экране «Домой»: в User-Agent нет «Safari/».
    expect(
      showInApp(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
        FCM,
      ),
    ).toBe(false)
    expect(
      showInApp(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
        FCM,
      ),
    ).toBe(false)
  })
})
