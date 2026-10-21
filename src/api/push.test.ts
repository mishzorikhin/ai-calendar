import { describe, expect, it } from 'vitest'
import { base64UrlToBytes } from './push'

describe('ключ сервера для подписки', () => {
  it('base64url → байты, с выравниванием и без', () => {
    expect([...base64UrlToBytes('AQID')]).toEqual([1, 2, 3])
    expect([...base64UrlToBytes('_-8')]).toEqual([255, 239])
    // Открытый ключ P-256 — 65 байт, первый 0x04.
    const key = base64UrlToBytes(
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    )
    expect(key).toHaveLength(65)
    expect(key[0]).toBe(4)
  })
})
