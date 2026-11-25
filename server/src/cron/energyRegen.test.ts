import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { OAuthError } from '../auth/oauth'
import { TokenStore } from '../auth/tokenStore'
import type { Database } from '../db/mongo'
import { createRepos } from '../db/repos'
import { fakeAccessToken, fakeLogger, fakeSecureStorage, fakeCardDeps, fakeTelegram, testConfig, testDb } from '../../test/fakes'
import { fakeMonday, fakeQueue } from '../../test/fakeMonday'
import { REGEN_MARK_KEEP_MS } from './energyRegen'

// Fixture Pokémon board (src/api/mock/fixtures.ts) — below full Energy (3): p2 ⚡2 Training, p4 ⚡1 Resting Lv 16,
// p6 ⚡2 Training, p10 ⚡2 Training, p12 ⚡0 Resting Lv 6. Everyone else is at ⚡3.
const BELOW_FULL = ['p10', 'p12', 'p2', 'p4', 'p6']

let open: Database[] = []
afterEach(async () => {
  await Promise.all(open.map((d) => d.close()))
  open = []
})

async function setup() {
  const log = fakeLogger()
  const database = await testDb()
  open.push(database)
  let t = Date.parse('2026-11-24T14:05:00Z')
  const now = () => new Date(t)
  const repos = createRepos(database.db, now)
  const unused = async () => {
    throw new Error('not used in this test')
  }
  // A refresh is refused like a revoked grant, so an expired token means "reconnect"
  const oauth = { exchangeCode: unused, refresh: async () => { throw new OAuthError('invalid_grant') } }
  const tokens = new TokenStore(fakeSecureStorage(), oauth, now)
  // Two different Pokémon boards, A and B
  const boards = {
    A: fakeMonday({ gymsBoard: 'gyms-A', pokemonBoard: 'pokemon-A' }),
    B: fakeMonday({ gymsBoard: 'gyms-B', pokemonBoard: 'pokemon-B' }),
  }
  const boardOf: Record<string, keyof typeof boards> = {}

  /** A user who went through OAuth and saved boards. `expired` → the refresh fails → reconnect needed. */
  const connect = async (userId: string, board: keyof typeof boards, { expired = false, withBoards = true } = {}) => {
    const exp = t / 1000 + (expired ? -60 : 24 * 3600) // valid all day: the tests move the clock by hours
    await tokens.save(userId, { accessToken: fakeAccessToken(exp), refreshToken: `r-${userId}`, exp })
    await repos.users.upsert({ userId, accountId: '202' })
    if (withBoards) await repos.users.setBoards(userId, boards[board].boards)
    boardOf[userId] = board
  }
  // Like mondayRequestFor: the stored token first (no valid token → ReconnectNeededError), then the board
  const mondayFor = (userId: string) => async <T,>(query: string, variables?: Record<string, unknown>) => {
    await tokens.getAccessToken(userId)
    return boards[boardOf[userId]].request<T>(query, variables)
  }

  const app = createApp({
    config: testConfig(), logger: log.logger, now, repos, tokens, oauth, mondayWithToken: () => unused, mondayFor,
    pokeApiFor: () => ({ getMoveset: unused, getTypeChart: unused, getEvolution: unused, getSpecies: unused }),
    queue: fakeQueue(), telegram: fakeTelegram(), ...fakeCardDeps(),
  })
  /** What the monday code scheduler does: a POST with no session. */
  const run = () => request(app).post('/mndy-cronjob/energy-regen').set('Content-Type', 'application/json').send({})
  const cronEvents = () => log.events().filter((e) => e.kind === 'cron')
  const changedIds = (b: keyof typeof boards) => boards[b].writes.map((w) => w.itemId).sort()

  return { app, database, repos, boards, connect, run, cronEvents, changedIds, tick: (ms: number) => (t += ms) }
}

describe('POST /mndy-cronjob/energy-regen', () => {
  it('every Pokémon below full gains +1 and full ones are untouched, in ONE board write', async () => {
    const { connect, run, boards, changedIds } = await setup()
    await connect('101', 'A')
    const res = await run()
    expect(res.status).toBe(200)
    const A = boards.A.pokemon
    expect(A.get('p2')).toMatchObject({ energy: 3, status: 'Training' })
    expect(A.get('p4')).toMatchObject({ energy: 2, status: 'Resting' })
    expect(A.get('p12')).toMatchObject({ energy: 1, status: 'Resting' })
    expect(A.get('p1')).toMatchObject({ energy: 3, status: 'Ready' })
    expect(A.get('p13')).toMatchObject({ energy: 3, status: 'Recruited' })
    expect(changedIds('A')).toEqual(BELOW_FULL)
    expect(boards.A.writeCalls()).toBe(1)
  })

  it('Resting reaching full → Ready at level ≥ 5, Training below', async () => {
    const { connect, run, boards } = await setup()
    await connect('101', 'A')
    const A = boards.A.pokemon
    A.set('p4', { ...A.get('p4')!, energy: 2 }) // Lv 16
    A.set('p12', { ...A.get('p12')!, energy: 2, level: 3 })
    await run()
    expect(A.get('p4')).toMatchObject({ energy: 3, status: 'Ready' })
    expect(A.get('p12')).toMatchObject({ energy: 3, status: 'Training' })
  })

  it('works with no session: it uses each user\'s stored token', async () => {
    const { connect, run, boards } = await setup()
    await connect('101', 'A')
    const res = await run() // no Authorization header at all
    expect(res.status).toBe(200)
    expect(boards.A.pokemon.get('p2')!.energy).toBe(3)
  })

  it('goes over every connected user with boards, Telegram-linked or not; users without boards are not counted', async () => {
    const { connect, run, boards, cronEvents, repos } = await setup()
    await connect('101', 'A') // no Telegram link
    await connect('303', 'B')
    await repos.links.replaceForUser({ chatId: '555', userId: '303', accountId: '202' })
    await connect('505', 'B', { withBoards: false })
    await run()
    expect(boards.A.pokemon.get('p2')!.energy).toBe(3)
    expect(boards.B.pokemon.get('p2')!.energy).toBe(3)
    expect(cronEvents()[0]).toMatchObject({ users: 2 })
  })

  it('one user failing does not stop others, and the run still answers 200', async () => {
    const { connect, run, boards, cronEvents } = await setup()
    await connect('101', 'A', { expired: true }) // refresh → invalid_grant → ReconnectNeededError
    await connect('303', 'B')
    const res = await run()
    expect(res.status).toBe(200)
    expect(boards.A.writeCalls()).toBe(0)
    expect(boards.B.pokemon.get('p2')!.energy).toBe(3)
    expect(cronEvents()[0].failures).toEqual([{ userId: '101', reason: 'RECONNECT' }])
  })

  it('two connected users on the same board → that board is updated once this hour', async () => {
    const { connect, run, boards, cronEvents } = await setup()
    await connect('101', 'A')
    await connect('404', 'A')
    await run()
    expect(boards.A.pokemon.get('p12')!.energy).toBe(1)
    expect(boards.A.writeCalls()).toBe(1)
    expect(cronEvents()[0]).toMatchObject({ users: 2, boards: 1, skipped: 1 })
  })

  it('a retried run in the same hour changes nothing; the next hour runs again', async () => {
    const { connect, run, boards, cronEvents, tick } = await setup()
    await connect('101', 'A')
    await run()
    await run()
    expect(boards.A.pokemon.get('p12')!.energy).toBe(1)
    expect(cronEvents()[1]).toMatchObject({ boards: 0, changed: 0, skipped: 1 })
    tick(60 * 60 * 1000)
    await run()
    expect(boards.A.pokemon.get('p12')!.energy).toBe(2)
  })

  it('a failed board write releases the hour mark, so a retry in the same hour applies it', async () => {
    const { connect, run, boards, cronEvents } = await setup()
    await connect('101', 'A')
    boards.A.failNextWrites(1)
    await run()
    expect(boards.A.pokemon.get('p12')!.energy).toBe(0)
    expect(cronEvents()[0].failures).toEqual([{ userId: '101', reason: 'Error' }])
    await run()
    expect(boards.A.pokemon.get('p12')!.energy).toBe(1)
  })

  it('emits one cron event with job, hourKey, users, boards, changed and failures', async () => {
    const { connect, run, cronEvents } = await setup()
    await connect('101', 'A')
    await connect('303', 'B')
    await run()
    expect(cronEvents()).toHaveLength(1)
    expect(cronEvents()[0]).toMatchObject({
      kind: 'cron', job: 'energy-regen', hourKey: '2026-11-24T14',
      users: 2, boards: 2, changed: 2 * BELOW_FULL.length, skipped: 0, failures: [],
    })
  })
})

describe('regen marks', () => {
  it(`a claim prunes marks older than ${REGEN_MARK_KEEP_MS / 3_600_000} h`, async () => {
    const { repos, database, tick } = await setup()
    expect(await repos.regenMarks.claim('pokemon-A', '2026-11-24T14')).toBe(true)
    expect(await repos.regenMarks.claim('pokemon-A', '2026-11-24T14')).toBe(false)
    tick(REGEN_MARK_KEEP_MS + 60_000)
    expect(await repos.regenMarks.claim('pokemon-A', '2026-11-26T15')).toBe(true)
    expect(await database.db.collection('regen_marks').countDocuments()).toBe(1)
  })
})
