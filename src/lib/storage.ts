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

export function readText(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeText(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    /* не критично */
  }
}
