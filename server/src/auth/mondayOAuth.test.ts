import { describe, expect, it, vi } from 'vitest'
import { fakeAccessToken, testConfig } from '../../test/fakes'
import { OAuthError, TOKEN_URL, createMondayOAuth } from './oauth'

const config = testConfig()
const exp = 1_900_000_000

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

describe('createMondayOAuth (monday token endpoint, as in the OAuth 2.1 migration docs)', () => {
  it('exchanges the code with a JSON POST carrying the verifier and the same redirect_uri', async () => {
    const access = fakeAccessToken(exp)
    const fetchImpl = fakeFetch(200, { access_token: access, refresh_token: 'r1', token_type: 'Bearer', scope: 'boards:read' })
    const token = await createMondayOAuth(config, fetchImpl).exchangeCode('the-code', 'the-verifier')

    expect(token).toEqual({ accessToken: access, refreshToken: 'r1', exp })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(TOKEN_URL)
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({
      grant_type: 'authorization_code',
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
      code: 'the-code',
      redirect_uri: 'https://server.test/oauth/callback',
      code_verifier: 'the-verifier',
    })
  })

  it('refreshes with a JSON POST', async () => {
    const fetchImpl = fakeFetch(200, { access_token: fakeAccessToken(exp), refresh_token: 'r2' })
    await createMondayOAuth(config, fetchImpl).refresh('r1')
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({
      grant_type: 'refresh_token', client_id: 'test-client-id', client_secret: 'test-client-secret', refresh_token: 'r1',
    })
  })

  it('turns monday\'s { error } into an OAuthError with that code', async () => {
    const fetchImpl = fakeFetch(400, { error: 'invalid_grant', error_description: 'bad code' })
    const err = await createMondayOAuth(config, fetchImpl).exchangeCode('c', 'v').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OAuthError)
    expect((err as OAuthError).code).toBe('invalid_grant')
  })
})
