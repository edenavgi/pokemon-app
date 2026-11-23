import { fakeQueue } from '../test/fakeMonday'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeLogger, fakeSecureStorage, fakeTelegram, signSessionToken, testConfig, testDb } from '../test/fakes'
import { TokenStore } from './auth/tokenStore'
import { createApp } from './app'
import type { Database } from './db/mongo'
import { createRepos } from './db/repos'

const config = testConfig()
const token = (dat?: Record<string, unknown>) => signSessionToken(config.mondayClientSecret, dat)
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` })

let open: Database[] = []
async function setup() {
  const log = fakeLogger()
  const database = await testDb()
  open.push(database)
  const now = () => new Date('2026-11-22T10:00:00Z')
  const repos = createRepos(database.db, now)
  const unused = async () => {
    throw new Error('not used in this test')
  }
  const oauth = { exchangeCode: unused, refresh: unused }
  const tokens = new TokenStore(fakeSecureStorage(), oauth, now)
  const app = createApp({
    config, logger: log.logger, now, repos, tokens, oauth, mondayWithToken: () => unused,
    mondayFor: () => unused, pokeApiFor: () => ({ getMoveset: unused, getTypeChart: unused }), queue: fakeQueue(), telegram: fakeTelegram(),
  })
  return { app, repos, database, ...log }
}
afterEach(async () => {
  await Promise.all(open.map((d) => d.close()))
  open = []
})

describe('GET /health', () => {
  it('returns ok with the server version', async () => {
    const { app } = await setup()
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, version: expect.any(String) })
  })
})

describe('wide events for HTTP', () => {
  it('every request emits one http event with method, path, status, durationMs', async () => {
    const { app, events } = await setup()
    await request(app).get('/health?probe=1')

    expect(events()).toHaveLength(1)
    expect(events()[0]).toMatchObject({ kind: 'http', method: 'GET', path: '/health', status: 200 })
    expect(typeof events()[0].durationMs).toBe('number')
    expect(typeof events()[0].traceId).toBe('string')
  })

  it('an unknown route is a 404 and still emits one event', async () => {
    const { app, events } = await setup()
    const res = await request(app).get('/nope')
    expect(res.status).toBe(404)
    expect(events()).toHaveLength(1)
    expect(events()[0]).toMatchObject({ kind: 'http', status: 404 })
  })

  it('two requests get two different traceIds', async () => {
    const { app, events } = await setup()
    await request(app).get('/health')
    await request(app).get('/health')
    const [a, b] = events()
    expect(a.traceId).not.toBe(b.traceId)
  })
})

describe('sessionToken on /api', () => {
  it('GET /api/me without Authorization → 401 and no handler runs', async () => {
    const { app, events } = await setup()
    const res = await request(app).get('/api/me')
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'UNAUTHORIZED' })
    expect(events()[0]).toMatchObject({ path: '/api/me', status: 401, authError: 'MISSING_TOKEN' })
    expect(events()[0].userId).toBeUndefined()
  })

  it('with a bad token → 401', async () => {
    const { app } = await setup()
    const res = await request(app).get('/api/me').set(bearer(signSessionToken('wrong-secret')))
    expect(res.status).toBe(401)
  })

  it('records who called, but never the token itself', async () => {
    const { app, info } = await setup()
    const t = token()
    await request(app).get('/api/me').set(bearer(t))
    expect(JSON.parse(info[0])).toMatchObject({ userId: '101', accountId: '202' })
    expect(info.join('\n')).not.toContain(t)
  })
})

describe('GET /api/me', () => {
  it('with a valid token and no user doc → connected:false', async () => {
    const { app } = await setup()
    const res = await request(app).get('/api/me').set(bearer(token()))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ connected: false, boardsKnown: false, telegram: { linked: false } })
  })

  it('reports connected, boards and the Telegram link once they exist', async () => {
    const { app, repos, database } = await setup()
    await repos.users.upsert({ userId: '101', accountId: '202' })
    await repos.users.setBoards('101', { gymsBoardId: 'g', pokemonBoardId: 'p' })
    await database.db.collection('links').insertOne({ _id: 'chat-1' as never, userId: '101', accountId: '202', linkedAt: new Date() })

    const res = await request(app).get('/api/me').set(bearer(token()))
    expect(res.body).toEqual({ connected: true, boardsKnown: true, telegram: { linked: true } })
  })
})

describe('PUT /api/me/boards', () => {
  const boards = { gymsBoardId: '18440319000', pokemonBoardId: '18440319935' }

  it('PUT /api/me/boards before OAuth → 409', async () => {
    const { app } = await setup()
    const res = await request(app).put('/api/me/boards').set(bearer(token())).send(boards)
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'NOT_CONNECTED' })
  })

  it('saves the boards of the calling user → 204', async () => {
    const { app, repos } = await setup()
    await repos.users.upsert({ userId: '101', accountId: '202' })
    const res = await request(app).put('/api/me/boards').set(bearer(token())).send(boards)
    expect(res.status).toBe(204)
    expect(await repos.users.get('101')).toMatchObject(boards)
  })

  it('rejects a body without both board ids → 400', async () => {
    const { app, repos } = await setup()
    await repos.users.upsert({ userId: '101', accountId: '202' })
    const res = await request(app).put('/api/me/boards').set(bearer(token())).send({ gymsBoardId: 'g' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'BAD_BOARDS' })
  })
})

describe('CORS', () => {
  it('CORS allows https://*.monday.app and rejects https://evil.test', async () => {
    const { app } = await setup()
    const ok = await request(app).get('/health').set('Origin', 'https://v1abc.cdn2.monday.app')
    expect(ok.headers['access-control-allow-origin']).toBe('https://v1abc.cdn2.monday.app')

    const evil = await request(app).get('/health').set('Origin', 'https://evil.test')
    expect(evil.headers['access-control-allow-origin']).toBeUndefined()

    const lookalike = await request(app).get('/health').set('Origin', 'https://monday.app.evil.test')
    expect(lookalike.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('answers the preflight for an Authorization header from monday', async () => {
    const { app } = await setup()
    const res = await request(app)
      .options('/api/me')
      .set('Origin', 'https://pokemon.monday.com')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization')
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-headers']?.toLowerCase()).toContain('authorization')
  })
})
