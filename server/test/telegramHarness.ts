// The Telegram side of the server, wired for tests: memory Mongo, a fake monday that answers me()
// per user, a fake Telegram that records replies, and helpers that act like the app and like Telegram.
import request from 'supertest'
import { afterEach, vi } from 'vitest'
import type { GqlRequest } from '@app/api/boards/gateway'
import { createApp } from '../src/app'
import { OAuthError } from '../src/auth/oauth'
import { TokenStore } from '../src/auth/tokenStore'
import type { Database } from '../src/db/mongo'
import { createRepos } from '../src/db/repos'
import { fakeAccessToken, fakeLogger, fakeSecureStorage, signSessionToken, testConfig, testDb } from './fakes'
import { fakeMonday, fakeQueue } from './fakeMonday'

export const config = testConfig()
export const SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token'
export const session = (userId: string, accountId = '202') =>
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

export async function telegramSetup() {
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
  // A refresh is refused like a revoked grant, so an expired token means "reconnect"
  const oauth = { exchangeCode: unused, refresh: async () => { throw new OAuthError('invalid_grant') } }
  const tokens = new TokenStore(secure, oauth, now)
  const monday = fakeMonday()
  const queue = fakeQueue()
  let mondayRequests = 0

  /** A user who went through OAuth: token in Secure Storage + users doc (+ boards). */
  const connect = async (userId: string, { boards = true } = {}) => {
    await tokens.save(userId, { accessToken: fakeAccessToken(t / 1000 + 3600), refreshToken: `r-${userId}`, exp: t / 1000 + 3600 })
    await repos.users.upsert({ userId, accountId: '202' })
    if (boards) await repos.users.setBoards(userId, monday.boards)
  }

  const meCalls: string[] = []
  const mondayFor = (userId: string): GqlRequest => async <T,>(query: string, variables?: Record<string, unknown>) => {
    await tokens.getAccessToken(userId) // like mondayRequestFor: no valid token → ReconnectNeededError
    if (query.includes('me {')) {
      meCalls.push(userId)
      const p = PEOPLE[userId]
      return { me: { id: Number(userId), name: p.name, account: p.account } } as T
    }
    mondayRequests++
    return monday.request<T>(query, variables)
  }

  const sent: { chatId: string; text: string }[] = []
  const telegram = {
    sendMessage: vi.fn(async (chatId: string, text: string) => void sent.push({ chatId, text })),
    sendPhoto: vi.fn(async () => {}),
    setWebhook: vi.fn(async () => {}),
    setMyCommands: vi.fn(async () => {}),
  }

  const deps = {
    config, logger: log.logger, now, repos, tokens, oauth,
    mondayWithToken: () => unused, mondayFor, pokeApiFor: () => ({ getMoveset: unused, getTypeChart: unused }),
    queue,
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
  /** A connected user (with boards) whose chat is already linked. */
  const linkedChat = async (chatId = '555', userId = '101') => {
    await connect(userId)
    await repos.links.replaceForUser({ chatId, userId, accountId: '202' })
  }

  return {
    app, deps, database, repos, tokens, secure, telegram, sent, meCalls, log, connect, linkCode, say, repliesTo,
    linkedChat, monday, queue, mondayRequests: () => mondayRequests,
    tick: (ms: number) => (t += ms),
  }
}
