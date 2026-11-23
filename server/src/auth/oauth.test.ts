import { fakeQueue } from '../../test/fakeMonday'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GqlRequest } from '@app/api/boards/gateway'
import { fakeAccessToken, fakeLogger, fakeSecureStorage, fakeTelegram, signSessionToken, testConfig, testDb } from '../../test/fakes'
import { createApp } from '../app'
import type { Database } from '../db/mongo'
import { createRepos } from '../db/repos'
import { challengeFor, pkcePair, type OAuthPort } from './oauth'
import { TokenStore, type StoredToken } from './tokenStore'

const config = testConfig()
const session = (userId = 101, accountId = 202) =>
  ({ Authorization: `Bearer ${signSessionToken(config.mondayClientSecret, { user_id: userId, account_id: accountId })}` })

const NEW_TOKEN: StoredToken = {
  accessToken: fakeAccessToken(Math.floor(Date.parse('2026-11-22T11:00:00Z') / 1000), 'brand-new'),
  refreshToken: 'refresh-brand-new',
  exp: Math.floor(Date.parse('2026-11-22T11:00:00Z') / 1000),
}

let open: Database[] = []
afterEach(async () => {
  await Promise.all(open.map((d) => d.close()))
  open = []
})

/** The token's owner as monday would report it through `me` */
async function setup(owner = { id: 101, account: { id: 202 } }) {
  const log = fakeLogger()
  const database = await testDb()
  open.push(database)
  let t = Date.parse('2026-11-22T10:00:00Z')
  const now = () => new Date(t)
  const secure = fakeSecureStorage()
  const oauth: OAuthPort = { exchangeCode: vi.fn(async () => NEW_TOKEN), refresh: vi.fn() }
  const tokens = new TokenStore(secure, oauth, now)
  const repos = createRepos(database.db, now)
  const meCalls: string[] = []
  const mondayWithToken = (token: string): GqlRequest => async <T,>() => {
    meCalls.push(token)
    return { me: { id: owner.id, name: 'Eden', account: { id: owner.account.id, name: 'Moveo' } } } as T
  }
  const notUsed = async () => {
    throw new Error('not used in this test')
  }
  const app = createApp({
    config, logger: log.logger, now, repos, tokens, oauth, mondayWithToken,
    mondayFor: () => notUsed, pokeApiFor: () => ({ getMoveset: notUsed, getTypeChart: notUsed, getEvolution: notUsed }), queue: fakeQueue(), telegram: fakeTelegram(),
  })
  return { app, repos, secure, oauth, meCalls, tick: (ms: number) => (t += ms), ...log }
}

/** Starts OAuth for the session user and returns the state the server put in the authorize URL. */
async function start(app: Awaited<ReturnType<typeof setup>>['app']) {
  const res = await request(app).post('/api/oauth/start').set(session())
  return new URL(res.body.authorizeUrl).searchParams.get('state')!
}

describe('PKCE', () => {
  it('challenge is base64url sha256 of the verifier (RFC 7636 appendix B)', () => {
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('pkcePair makes a random 43-char base64url verifier and its challenge', () => {
    const a = pkcePair()
    const b = pkcePair()
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.challenge).toBe(challengeFor(a.verifier))
    expect(a.verifier).not.toBe(b.verifier)
  })
})

describe('POST /api/oauth/start', () => {
  it('start returns an authorize URL with client_id, redirect_uri, state, code_challenge, code_challenge_method=S256', async () => {
    const { app } = await setup()
    const res = await request(app).post('/api/oauth/start').set(session())
    expect(res.status).toBe(200)

    const url = new URL(res.body.authorizeUrl)
    expect(url.origin + url.pathname).toBe('https://auth.monday.com/oauth2/authorize')
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe('https://server.test/oauth/callback')
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('the URL never carries the verifier (only its challenge)', async () => {
    const { app, oauth } = await setup()
    const state = await start(app)
    await request(app).get(`/oauth/callback?code=c1&state=${state}`)
    const verifier = vi.mocked(oauth.exchangeCode).mock.calls[0][1]
    expect(challengeFor(verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(state).not.toBe(verifier)
  })

  it('needs a sessionToken', async () => {
    const { app } = await setup()
    expect((await request(app).post('/api/oauth/start')).status).toBe(401)
  })
})

describe('GET /oauth/callback', () => {
  it('callback stores the token and upserts the users doc', async () => {
    const { app, repos, secure, oauth, meCalls } = await setup()
    const state = await start(app)

    const res = await request(app).get(`/oauth/callback?code=the-code&state=${state}`)
    expect(res.status).toBe(200)
    expect(res.type).toBe('text/html')
    expect(res.text).toContain('Connected')

    expect(vi.mocked(oauth.exchangeCode).mock.calls[0][0]).toBe('the-code')
    expect(meCalls).toEqual([NEW_TOKEN.accessToken]) // me() asked with the NEW token
    expect(await secure.get('monday-token:101')).toEqual(NEW_TOKEN)
    expect(await repos.users.get('101')).toMatchObject({ _id: '101', accountId: '202' })
  })

  it('callback with unknown or expired state → 400, nothing stored', async () => {
    const { app, repos, secure, oauth, tick } = await setup()
    expect((await request(app).get('/oauth/callback?code=c&state=made-up')).status).toBe(400)

    const state = await start(app)
    tick(11 * 60 * 1000) // states live 10 minutes
    expect((await request(app).get(`/oauth/callback?code=c&state=${state}`)).status).toBe(400)

    expect(oauth.exchangeCode).not.toHaveBeenCalled()
    expect(secure.map.size).toBe(0)
    expect(await repos.users.get('101')).toBeNull()
  })

  it('callback twice with the same state → second is 400', async () => {
    const { app } = await setup()
    const state = await start(app)
    expect((await request(app).get(`/oauth/callback?code=c&state=${state}`)).status).toBe(200)
    expect((await request(app).get(`/oauth/callback?code=c&state=${state}`)).status).toBe(400)
  })

  it('callback without code or state → 400', async () => {
    const { app } = await setup()
    expect((await request(app).get('/oauth/callback')).status).toBe(400)
  })

  it('when the user declines, monday sends ?error= → 400, nothing exchanged, the state is used up', async () => {
    const { app, oauth } = await setup()
    const state = await start(app)
    const res = await request(app).get(`/oauth/callback?error=access_denied&state=${state}`)
    expect(res.status).toBe(400)
    expect(res.text).toContain('not connected')
    expect(oauth.exchangeCode).not.toHaveBeenCalled()
    expect((await request(app).get(`/oauth/callback?code=c&state=${state}`)).status).toBe(400)
  })

  it('callback where me() is a different user → 403, nothing stored', async () => {
    const { app, repos, secure } = await setup({ id: 999, account: { id: 202 } })
    const state = await start(app)
    const res = await request(app).get(`/oauth/callback?code=c&state=${state}`)
    expect(res.status).toBe(403)
    expect(secure.map.size).toBe(0)
    expect(await repos.users.get('101')).toBeNull()
    expect(await repos.users.get('999')).toBeNull()
  })

  it('no event emitted by these routes contains the access or refresh token, the code or the verifier', async () => {
    const { app, oauth, info, errors } = await setup()
    const state = await start(app)
    await request(app).get(`/oauth/callback?code=secret-code-123&state=${state}`)
    const verifier = vi.mocked(oauth.exchangeCode).mock.calls[0][1]

    const all = [...info, ...errors.map((e) => e.msg)].join('\n')
    for (const secret of [NEW_TOKEN.accessToken, NEW_TOKEN.refreshToken, 'secret-code-123', verifier]) {
      expect(all).not.toContain(secret)
    }
    expect(JSON.parse(info.at(-1)!)).toMatchObject({ path: '/oauth/callback', status: 200, oauth: 'connected', userId: '101' })
  })
})
