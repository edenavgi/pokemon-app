import { describe, expect, it, vi } from 'vitest'
import { fakeAccessToken, fakeSecureStorage } from '../../test/fakes'
import { OAuthError, type OAuthPort } from './oauth'
import { ReconnectNeededError, TokenStore, tokenFromResponse, type StoredToken } from './tokenStore'

const NOW = Date.parse('2026-11-22T10:00:00Z')
const sec = (ms: number) => Math.floor(ms / 1000)
const KEY = 'monday-token:101'

function stored(label: string, minutesLeft: number): StoredToken {
  const exp = sec(NOW) + minutesLeft * 60
  return { accessToken: fakeAccessToken(exp, label), refreshToken: `refresh-${label}`, exp }
}

function setup(refresh: OAuthPort['refresh']) {
  const secure = fakeSecureStorage()
  const oauth: OAuthPort = { exchangeCode: vi.fn(), refresh: vi.fn(refresh) }
  const store = new TokenStore(secure, oauth, () => new Date(NOW))
  return { secure, oauth, store }
}

describe('TokenStore', () => {
  it('returns the stored token when exp is far', async () => {
    const { secure, oauth, store } = setup(async () => stored('never', 60))
    const a = stored('a', 60)
    await secure.set(KEY, a)
    expect(await store.getAccessToken('101')).toBe(a.accessToken)
    expect(oauth.refresh).not.toHaveBeenCalled()
  })

  it('refreshes when < 5 min left and saves the rotated pair', async () => {
    const b = stored('b', 60)
    const { secure, oauth, store } = setup(async () => b)
    await secure.set(KEY, stored('a', 4))

    expect(await store.getAccessToken('101')).toBe(b.accessToken)
    expect(oauth.refresh).toHaveBeenCalledWith('refresh-a')
    expect(await secure.get(KEY)).toEqual(b) // the NEW refresh token is stored: the old one no longer works
  })

  it('two concurrent calls refresh once', async () => {
    const b = stored('b', 60)
    const { secure, oauth, store } = setup(async () => {
      await new Promise((r) => setTimeout(r, 5))
      return b
    })
    await secure.set(KEY, stored('a', 1))

    const [x, y] = await Promise.all([store.getAccessToken('101'), store.getAccessToken('101')])
    expect([x, y]).toEqual([b.accessToken, b.accessToken])
    expect(oauth.refresh).toHaveBeenCalledTimes(1)
  })

  it('refresh invalid_grant re-reads and retries once (another instance rotated it)', async () => {
    const fresh = stored('rotated-elsewhere', 60)
    const { secure, oauth, store } = setup(async () => {
      await secure.set(KEY, fresh) // the other instance saved its rotated pair first
      throw new OAuthError('invalid_grant')
    })
    await secure.set(KEY, stored('a', 2))

    expect(await store.getAccessToken('101')).toBe(fresh.accessToken)
    expect(oauth.refresh).toHaveBeenCalledTimes(1) // the re-read token was fresh: no second refresh
  })

  it('second invalid_grant → ReconnectNeededError', async () => {
    const { secure, oauth, store } = setup(async () => {
      throw new OAuthError('invalid_grant')
    })
    await secure.set(KEY, stored('revoked', 2))

    await expect(store.getAccessToken('101')).rejects.toBeInstanceOf(ReconnectNeededError)
    // The re-read found the same refresh token: retrying it would fail the same way
    expect(oauth.refresh).toHaveBeenCalledTimes(1)
  })

  it('re-read finds a newer but also expiring token → refreshes that one once', async () => {
    const final = stored('final', 60)
    let calls = 0
    const { secure, oauth, store } = setup(async (refreshToken) => {
      calls++
      if (calls === 1) {
        await secure.set(KEY, stored('b', 1)) // rotated elsewhere, already close to expiry
        throw new OAuthError('invalid_grant')
      }
      expect(refreshToken).toBe('refresh-b')
      return final
    })
    await secure.set(KEY, stored('a', 1))
    expect(await store.getAccessToken('101')).toBe(final.accessToken)
    expect(oauth.refresh).toHaveBeenCalledTimes(2)
  })

  it('second invalid_grant after re-reading a newer token → ReconnectNeededError', async () => {
    let calls = 0
    const { secure, store } = setup(async () => {
      if (++calls === 1) await secure.set(KEY, stored('b', 1))
      throw new OAuthError('invalid_grant')
    })
    await secure.set(KEY, stored('a', 1))
    await expect(store.getAccessToken('101')).rejects.toBeInstanceOf(ReconnectNeededError)
  })

  it('a user without a stored token → ReconnectNeededError', async () => {
    const { store } = setup(async () => stored('x', 60))
    await expect(store.getAccessToken('404')).rejects.toBeInstanceOf(ReconnectNeededError)
  })

  it('other refresh errors are not turned into "reconnect"', async () => {
    const { secure, store } = setup(async () => {
      throw new Error('network down')
    })
    await secure.set(KEY, stored('a', 1))
    await expect(store.getAccessToken('101')).rejects.toThrow('network down')
  })

  it('save, has and delete use the monday-token:<userId> key', async () => {
    const { secure, store } = setup(async () => stored('x', 60))
    expect(await store.has('101')).toBe(false)
    await store.save('101', stored('a', 60))
    expect(secure.map.has(KEY)).toBe(true)
    expect(await store.has('101')).toBe(true)
    await store.delete('101')
    expect(await store.has('101')).toBe(false)
  })
})

describe('tokenFromResponse', () => {
  it('reads exp from the access token JWT (the response has no expires_in)', () => {
    const exp = sec(NOW) + 3600
    const access = fakeAccessToken(exp)
    expect(tokenFromResponse({ access_token: access, refresh_token: 'r1', token_type: 'Bearer', scope: 'boards:read' }))
      .toEqual({ accessToken: access, refreshToken: 'r1', exp })
  })

  it('rejects a response without a refresh token', () => {
    expect(() => tokenFromResponse({ access_token: fakeAccessToken(sec(NOW) + 60) })).toThrow(OAuthError)
  })
})
