/** Цвет аватарки из логина — одинаковый у всех клиентов для одного человека. */
export function userColor(username: string): string {
  const palette = ['#dfe4f8', '#fde4d8', '#d8f0e0', '#f3e2f5', '#fdf0c8', '#dceef7', '#f8ddd8']
  let h = 0
  for (const ch of username) h = (h * 31 + ch.charCodeAt(0)) % 997
  return palette[h % palette.length]!
}

export function userInitials(user: { username: string; name: string }): string {
  const source = user.name.trim() || user.username
  return [...source].slice(0, 1).join('').toUpperCase()
}
