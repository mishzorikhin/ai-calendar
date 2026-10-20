// Хранилище может быть недоступно (приватный режим, заблокированные данные сайта) —
// тогда флаги просто не запоминаются.

export function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

export function writeFlag(key: string): void {
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    /* не критично */
  }
}
