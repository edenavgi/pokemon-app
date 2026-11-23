import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GqlRequest } from '@app/api/boards/gateway'
import { fakeAccessToken, fakeLogger, fakeSecureStorage, signSessionToken, testConfig, testDb } from '../../test/fakes'
import { fakeMonday } from '../../test/fakeMonday'
import { createApp } from '../app'
import { TokenStore } from '../auth/tokenStore'
import type { Database } from '../db/mongo'
import { createRepos } from '../db/repos'
import { hashCode, LINK_CODE_TTL_MS } from './linking'
import { texts } from './texts'
import { resolveChat } from './webhook'

const config = testConfig()
const SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token'
const session = (userId: string, accountId = '202') =>
  ({ Authorization: `Bearer ${signSessionToken(config.mondayClientSecret, { user_id: Number(userId), account_id: Number(accountId) })}` })

// Who each user is in monday (answered to me() with that user's token)
const PEOPLE: Record<string, { name: string; account: { id: number; name: string } }> = {
  '101': { name: 'Ash', account: { id: 202, name: 'Pallet' } },
  '303': { name: 'Misty', account: { id: 202, name: 'Pallet' } },
}

let open: Database[] = []
afterEach(async () => {
  await Promise.all(open.map((d) => d.close()))
  open = []
})

async function setup() {
  const log = fakeLogger()
  const database = await testDb()
  open.push(database)
  let t = Date.parse('2026-11-23T10:00:00Z')
  const now = () => new Date(t)
  const repos = createRepos(database.db, now)
  const secure = fakeSecureStorage()
  const unused = async () => {
    throw new Error('not used in this test')
  }
  const oauth = { exchangeCode: unused, refresh: unused }
  const tokens = new TokenStore(secure, oauth, now)
  const monday = fakeMonday()

  /** A user who went through OAuth: token in Secure Storage + users doc (+ boards). */
  const connect = async (userId: string, { boards = true } = {}) => {
    await tokens.save(userId, { accessToken: fakeAccessToken(t / 1000 + 3600), refreshToken: `r-${userId}`, exp: t / 1000 + 3600 })
    await repos.users.upsert({ userId, accountId: '202' })
    if (boards) await repos.users.setBoards(userId, monday.boards)
  }

  const meCalls: string[] = []
  const mondayFor = (userId: string): GqlRequest => async <T,>(query: string, variables?: Record<string, unknown>) => {
    if (query.includes('me {')) {
      meCalls.push(userId)
      const p = PEOPLE[userId]
      return { me: { id: Number(userId), name: p.name, account: p.account } } as T
    }
    return monday.request<T>(query, variables)
  }

  const sent: { chatId: string; text: string }[] = []
  const telegram = {
    sendMessage: vi.fn(async (chatId: string, text: string) => void sent.push({ chatId, text })),
    sendPhoto: vi.fn(async () => {}),
    setWebhook: vi.fn(async () => {}),
  }

  const deps = {
    config, logger: log.logger, now, repos, tokens, oauth,
    mondayWithToken: () => unused, mondayFor, pokeApiFor: () => ({ getMoveset: unused, getTypeChart: unused }),
    queue: { publishMessage: unused, validateMessageSecret: () => false },
    telegram,
  }
  const app = createApp(deps)

  /** The t.me link the app gets for this user, and the code in it. */
  const linkCode = async (userId = '101') => {
    const res = await request(app).post('/api/telegram/link-code').set(session(userId))
    const url = res.body.url as string
    return { res, url, code: url?.split('?start=')[1] }
  }
  let nextUpdate = 1
  /** Telegram POSTing one text message to our webhook. */
  const say = (chatId: string, text: string, opts: { updateId?: number; secret?: string | null } = {}) => {
    const req = request(app).post('/telegram/webhook').set('Content-Type', 'application/json')
    if (opts.secret !== null) req.set(SECRET_HEADER, opts.secret ?? config.telegramWebhookSecret)
    return req.send({
      update_id: opts.updateId ?? nextUpdate++,
      message: { message_id: 1, chat: { id: Number(chatId), type: 'private' }, from: { id: Number(chatId) }, date: 0, text },
    })
  }
  const repliesTo = (chatId: string) => sent.filter((m) => m.chatId === chatId).map((m) => m.text)

  return {
    app, deps, database, repos, tokens, secure, telegram, sent, meCalls, log, connect, linkCode, say, repliesTo,
    tick: (ms: number) => (t += ms),
  }
}

describe('POST /api/telegram/link-code', () => {
  it('needs a session', async () => {
    const { app } = await setup()
    expect((await request(app).post('/api/telegram/link-code')).status).toBe(401)
  })

  it('needs a stored monday token: 409 NOT_CONNECTED', async () => {
    const { linkCode } = await setup()
    const { res } = await linkCode('101')
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'NOT_CONNECTED' })
  })

  it('returns a t.me deep link with a fresh code, and stores only its hash', async () => {
    const { connect, linkCode, database } = await setup()
    await connect('101')
    const { res, url, code } = await linkCode('101')
    expect(res.status).toBe(200)
    expect(url).toMatch(/^https:\/\/t\.me\/test_bot\?start=[A-Za-z0-9_-]{43}$/)
    const docs = await database.db.collection('link_codes').find().toArray()
    expect(docs).toHaveLength(1)
    expect(docs[0]._id).toBe(hashCode(code))
    expect(JSON.stringify(docs)).not.toContain(code)
  })
})

describe('POST /telegram/webhook', () => {
  it.each([['without', null], ['with a wrong', 'nope']] as const)('%s secret header → 401 and no handler', async (_, secret) => {
    const { connect, linkCode, say, sent, repos } = await setup()
    await connect('101')
    const { code } = await linkCode('101')
    const res = await say('555', `/start ${code}`, { secret })
    expect(res.status).toBe(401)
    expect(sent).toEqual([])
    expect(await repos.links.get('555')).toBeNull()
  })

  it('/start with a valid code links the chat, replies with user and account, and the code is gone', async () => {
    const { connect, linkCode, say, repliesTo, repos, database, app } = await setup()
    await connect('101')
    const { code } = await linkCode('101')
    expect((await say('555', `/start ${code}`)).status).toBe(200)
    expect(await repos.links.get('555')).toMatchObject({ userId: '101', accountId: '202' })
    expect(repliesTo('555')).toEqual([texts.linked('Ash', 'Pallet', '101', '202')])
    expect(await database.db.collection('link_codes').countDocuments()).toBe(0)
    // the app sees it too
    const me = await request(app).get('/api/me').set(session('101'))
    expect(me.body.telegram).toEqual({ linked: true })
  })

  it('the same code twice → the second gets badCode', async () => {
    const { connect, linkCode, say, repliesTo } = await setup()
    await connect('101')
    const { code } = await linkCode('101')
    await say('555', `/start ${code}`)
    await say('666', `/start ${code}`)
    expect(repliesTo('666')).toEqual([texts.badCode])
  })

  it('a code older than 10 minutes → badCode', async () => {
    const { connect, linkCode, say, repliesTo, repos, tick } = await setup()
    await connect('101')
    const { code } = await linkCode('101')
    tick(LINK_CODE_TTL_MS + 1)
    await say('555', `/start ${code}`)
    expect(repliesTo('555')).toEqual([texts.badCode])
    expect(await repos.links.get('555')).toBeNull()
  })

  it('an unknown code → badCode', async () => {
    const { say, repliesTo } = await setup()
    await say('555', '/start AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    expect(repliesTo('555')).toEqual([texts.badCode])
  })

  it('the link belongs to the user who asked for the code', async () => {
    const { connect, linkCode, say, repos, repliesTo, meCalls } = await setup()
    await connect('101')
    await connect('303')
    const { code } = await linkCode('303')
    await say('555', `/start ${code}`)
    expect(await repos.links.get('555')).toMatchObject({ userId: '303' })
    expect(meCalls).toEqual(['303'])
    expect(repliesTo('555')[0]).toContain('Misty')
  })

  it("a new code replaces the user's older one", async () => {
    const { connect, linkCode, say, repliesTo } = await setup()
    await connect('101')
    const first = await linkCode('101')
    await linkCode('101')
    await say('555', `/start ${first.code}`)
    expect(repliesTo('555')).toEqual([texts.badCode])
  })

  it('relinking a user to a new chat removes the old link', async () => {
    const { connect, linkCode, say, repos, repliesTo } = await setup()
    await connect('101')
    await say('555', `/start ${(await linkCode('101')).code}`)
    await say('777', `/start ${(await linkCode('101')).code}`)
    expect(await repos.links.get('555')).toBeNull()
    expect(await repos.links.get('777')).toMatchObject({ userId: '101' })
    await say('555', '/gyms')
    expect(repliesTo('555').at(-1)).toBe(texts.notLinked)
  })

  it('any command from an unlinked chat → notLinked reply', async () => {
    const { say, repliesTo } = await setup()
    for (const text of ['/gyms', '/start', 'hello']) await say('555', text)
    expect(repliesTo('555')).toEqual([texts.notLinked, texts.notLinked, texts.notLinked])
  })

  it('ignores a duplicate update_id', async () => {
    const { say, repliesTo } = await setup()
    expect((await say('555', '/gyms', { updateId: 9 })).status).toBe(200)
    expect((await say('555', '/gyms', { updateId: 9 })).status).toBe(200)
    expect(repliesTo('555')).toHaveLength(1)
  })

  it('forgets update ids older than 24 h when it stores a new one', async () => {
    const { say, database, tick } = await setup()
    await say('555', '/gyms', { updateId: 1 })
    tick(25 * 60 * 60 * 1000)
    await say('555', '/gyms', { updateId: 2 })
    const ids = (await database.db.collection('tg_updates').find().toArray()).map((d) => d._id)
    expect(ids).toEqual([2])
  })

  it('answers 200 even when replying fails, and logs the error', async () => {
    const { say, telegram, log } = await setup()
    telegram.sendMessage.mockRejectedValueOnce(new Error('telegram down'))
    expect((await say('555', '/gyms')).status).toBe(200)
    expect(JSON.stringify(log.events())).toContain('telegram down')
  })

  it('ignores updates without a text message', async () => {
    const { app, sent } = await setup()
    const res = await request(app).post('/telegram/webhook').set(SECRET_HEADER, config.telegramWebhookSecret)
      .send({ update_id: 50, edited_message: { chat: { id: 1 }, text: 'x' } })
    expect(res.status).toBe(200)
    expect(sent).toEqual([])
  })

  it('logs updateId, chatId and the command on the http event, but never the code', async () => {
    const { connect, linkCode, say, log } = await setup()
    await connect('101')
    const { code } = await linkCode('101')
    await say('555', `/start ${code}`, { updateId: 77 })
    const ev = log.events().find((e) => e.path === '/telegram/webhook')
    expect(ev).toMatchObject({ updateId: 77, chatId: '555', command: '/start', status: 200 })
    expect(JSON.stringify(log.events())).not.toContain(code)
  })
})

describe('resolveChat', () => {
  it('an unlinked chat → notLinked', async () => {
    const { deps } = await setup()
    expect(await resolveChat(deps, '555')).toEqual({ ok: false, reply: texts.notLinked })
  })

  it('a linked user without boards → noBoards', async () => {
    const { deps, connect, repos } = await setup()
    await connect('101', { boards: false })
    await repos.links.replaceForUser({ chatId: '555', userId: '101', accountId: '202' })
    expect(await resolveChat(deps, '555')).toEqual({ ok: false, reply: texts.noBoards })
  })

  it('a linked user whose monday token is gone → reconnect', async () => {
    const { deps, connect, repos, secure } = await setup()
    await connect('101')
    await repos.links.replaceForUser({ chatId: '555', userId: '101', accountId: '202' })
    secure.map.clear()
    expect(await resolveChat(deps, '555')).toEqual({ ok: false, reply: texts.reconnect })
  })

  it('a linked, connected user with boards → the user, the account and a board gateway', async () => {
    const { deps, connect, repos } = await setup()
    await connect('101')
    await repos.links.replaceForUser({ chatId: '555', userId: '101', accountId: '202' })
    const r = await resolveChat(deps, '555')
    expect(r).toMatchObject({ ok: true, userId: '101', accountId: '202', boards: { gymsBoardId: 'board-gyms' } })
    if (!r.ok) throw new Error('expected ok')
    expect((await r.gateway.listGyms({ boardIds: [r.boards.gymsBoardId] })).map((g) => g.name)).toContain('Cinnabar Gym')
  })
})
