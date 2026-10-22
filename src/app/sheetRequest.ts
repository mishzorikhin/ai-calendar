/**
 * Открыть шторку главной с другого экрана («Запомнил: …» в чате → «Что ассистент знает»).
 * Главная может быть смонтирована под чатом, поэтому просьба — событие: подписчик получает её
 * сразу, а если главной пока нет — заберёт при появлении.
 */
let requested: string | null = null
const listeners = new Set<(sheet: string) => void>()

export function requestHomeSheet(sheet: string): void {
  if (listeners.size === 0) {
    requested = sheet
    return
  }
  for (const fn of listeners) fn(sheet)
}

/** Подписаться на просьбы; отложенная просьба отдаётся сразу. Возвращает отписку. */
export function onHomeSheet(fn: (sheet: string) => void): () => void {
  listeners.add(fn)
  if (requested) {
    const sheet = requested
    requested = null
    fn(sheet)
  }
  return () => listeners.delete(fn)
}
