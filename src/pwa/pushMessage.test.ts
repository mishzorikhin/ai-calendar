import { describe, expect, it } from 'vitest'
import { notificationActions, notificationOptions, parsePushMessage, snoozedMessage } from './pushMessage'

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
})
