import { afterEach, describe, expect, it, vi } from 'vitest'
import { setSession } from './session'

const alice = { token: 'a', user: { id: 1, username: 'alice', name: 'Алиса' } }
const bob = { token: 'b', user: { id: 2, username: 'bob', name: 'Боб' } }

afterEach(() => {
  setSession(null)
  vi.unstubAllGlobals()
})

describe('сессия и кэш service worker', () => {
  it('выход и смена аккаунта стирают кэш ответов API; обновление профиля — нет', () => {
    setSession(alice)
    const del = vi.fn(async () => true)
    vi.stubGlobal('caches', { delete: del })

    setSession({ ...alice, user: { ...alice.user, name: 'Алиса Z' } })
    expect(del).not.toHaveBeenCalled()

    setSession(bob)
    expect(del).toHaveBeenCalledWith('api')

    del.mockClear()
    setSession(null)
    expect(del).toHaveBeenCalledWith('api')
  })
})
