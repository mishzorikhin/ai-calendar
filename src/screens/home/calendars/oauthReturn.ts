/** Результат возврата со страницы входа Google/Microsoft: /?calendars=connected|error&message=… */
export type OAuthReturn = { ok: boolean; message: string }

/** Читает параметры возврата из адреса; null — это обычный запуск. Без побочных эффектов. */
export function readOAuthReturn(): OAuthReturn | null {
  const params = new URLSearchParams(window.location.search)
  const status = params.get('calendars')
  if (!status) return null
  return status === 'connected'
    ? { ok: true, message: 'Календарь подключён — его события уже в приложении' }
    : { ok: false, message: params.get('message') || 'Не получилось подключить календарь' }
}

/** Убирает параметры возврата из адреса, чтобы перезагрузка не показала их снова. */
export function clearOAuthReturn(): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('calendars')) return
  url.searchParams.delete('calendars')
  url.searchParams.delete('message')
  window.history.replaceState(window.history.state, '', url)
}
