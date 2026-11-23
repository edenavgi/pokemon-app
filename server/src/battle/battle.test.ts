import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Move } from '@app/api/GameApi'
import { TYPE_CHART } from '@app/api/mock/fixtures'
import { simulateArena, type ArenaTurn } from '@app/game/arena'
import { mulberry32 } from '@app/game/rng'
import { battleErrorText } from '@app/lib/messages'
import { fakeLogger, fakeSecureStorage, signSessionToken, testConfig, testDb } from '../../test/fakes'
import { fakeMonday, fakeQueue } from '../../test/fakeMonday'
import { createApp } from '../app'
import { TokenStore } from '../auth/tokenStore'
import { QuotaError, type Database } from '../db/mongo'
import { createRepos } from '../db/repos'
import { battleSummaryText, parseQueueBody, type BattleDoc } from './service'

const config = testConfig()
const session = (userId = 101, accountId = 202) =>
  ({ Authorization: `Bearer ${signSessionToken(config.mondayClientSecret, { user_id: userId, account_id: accountId })}` })

const MOVES: Record<number, Move[]> = {
  4: [{ name: 'Scratch', type: 'Normal', power: 40 }, { name: 'Ember', type: 'Fire', power: 40 }],
  7: [{ name: 'Tackle', type: 'Normal', power: 40 }, { name: 'Water Gun', type: 'Water', power: 40 }],
}

let open: Database[] = []
afterEach(async () => {
  await Promise.all(open.map((d) => d.close()))
  open = []
})

async function setup({ connect = true, boards = true } = {}) {
  const log = fakeLogger()
  const database = await testDb()
  open.push(database)
  let t = Date.parse('2026-11-23T10:00:00Z')
  const now = () => new Date(t)
  const repos = createRepos(database.db, now)
  const monday = fakeMonday()
  const queue = fakeQueue()
  if (connect) await repos.users.upsert({ userId: '101', accountId: '202' })
  if (connect && boards) await repos.users.setBoards('101', monday.boards)

  const unused = async () => {
    throw new Error('not used in this test')
  }
  const oauth = { exchangeCode: unused, refresh: unused }
  const pokeApi = {
    getMoveset: vi.fn(async (dex: number) => MOVES[dex] ?? []),
    getTypeChart: vi.fn(async () => TYPE_CHART),
  }
  const app = createApp({
    config, logger: log.logger, now, repos,
    tokens: new TokenStore(fakeSecureStorage(), oauth, now), oauth, mondayWithToken: () => unused,
    mondayFor: () => monday.request,
    pokeApiFor: () => pokeApi,
    queue,
  })

  /** Starts a battle as user 101 and returns its id. */
  const start = async (gymAId = 'g1', gymBId = 'g2') => {
    const res = await request(app).post('/api/battles').set(session()).send({ gymAId, gymBId })
    return { res, battleId: res.body.battleId as string }
  }
  /** What monday code does with a queue message: POST it to /mndy-queue with the secret. */
  const deliver = (body = queue.published.at(-1)!, secret = queue.secret) =>
    request(app).post(`/mndy-queue?secret=${secret}`).set('Content-Type', 'application/json').send(body)

  return { app, repos, monday, queue, start, deliver, tick: (ms: number) => (t += ms), ...log }
}

describe('POST /api/battles', () => {
  it('POST /api/battles publishes one message after inserting the battle and returns 202', async () => {
    const { repos, queue, start } = await setup()
    let docAtPublish: BattleDoc | null = null
    queue.onPublish = async (message) => {
      docAtPublish = await repos.battles.get(JSON.parse(message).battleId)
    }
    const { res, battleId } = await start()

    expect(res.status).toBe(202)
    expect(queue.published).toHaveLength(1)
    const doc = await repos.battles.get(battleId)
    expect(docAtPublish).not.toBeNull() // the battle existed before the message went out
    expect(doc).toMatchObject({
      status: 'queued', source: 'app', userId: '101', accountId: '202', gymsBoardId: 'board-gyms',
      gymA: { id: 'g1', name: 'Cinnabar Gym' }, gymB: { id: 'g2', name: 'Cerulean Gym' },
    })
    expect(typeof doc!.seed).toBe('number')
    expect(JSON.parse(queue.published[0])).toEqual({ v: 1, battleId, traceId: doc!.traceId })
  })

  it('POST /api/battles with no eligible fighters → 400 with the v1 text, and nothing published', async () => {
    const { monday, queue, repos, start } = await setup()
    monday.pokemon.get('p3')!.status = 'Resting' // Cerulean's only Ready Pokémon
    const { res } = await start()
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'B_NOT_ELIGIBLE', message: battleErrorText('B_NOT_ELIGIBLE') })
    expect(queue.published).toHaveLength(0)
    expect(await repos.battles.recentForBoard('board-gyms', 10)).toHaveLength(0)
  })

  it('rejects the same gym twice, an unknown gym, and a bad body', async () => {
    const { app, start } = await setup()
    expect((await start('g1', 'g1')).res.body.error).toBe('SAME_GYM')
    expect((await start('g1', 'nope')).res.body.error).toBe('UNKNOWN_GYM')
    expect((await request(app).post('/api/battles').set(session()).send({ gymAId: 'g1' })).status).toBe(400)
  })

  it('a user who has not connected monday → 409 NOT_CONNECTED; no boards yet → 409 NO_BOARDS', async () => {
    expect((await (await setup({ connect: false })).start()).res).toMatchObject({ status: 409, body: { error: 'NOT_CONNECTED' } })
    expect((await (await setup({ boards: false })).start()).res).toMatchObject({ status: 409, body: { error: 'NO_BOARDS' } })
  })
})

describe('POST /mndy-queue', () => {
  it('queue route rejects a wrong or missing secret with 401', async () => {
    const { start, deliver, repos } = await setup()
    const { battleId } = await start()
    expect((await deliver(undefined, 'wrong')).status).toBe(401)
    expect((await deliver(undefined, '')).status).toBe(401)
    expect((await repos.battles.get(battleId))!.status).toBe('queued')
  })

  it('runBattleMessage writes every turn and the replay GET returns them in order, equal to a direct run with the same seed and teams', async () => {
    const { app, repos, start, deliver } = await setup()
    const { battleId } = await start()
    expect((await deliver()).status).toBe(200)

    const doc = (await repos.battles.get(battleId))!
    expect(doc.status).toBe('done')
    const expected: ArenaTurn[] = [...simulateArena(doc.snapshot!.teams.a, doc.snapshot!.teams.b, TYPE_CHART, mulberry32(doc.seed))]

    const res = await request(app).get(`/api/battles/${battleId}?turns=1`).set(session())
    expect(res.status).toBe(200)
    expect(res.body.turns).toEqual(expected)
    expect(res.body.battle).toMatchObject({ _id: battleId, status: 'done', outcome: { turnCount: expected.length } })
    expect(res.body.battle).not.toHaveProperty('snapshot')
    expect(res.body.battle).not.toHaveProperty('seed')
    expect(res.body.battle).not.toHaveProperty('userId')

    const summaryOnly = await request(app).get(`/api/battles/${battleId}?turns=0`).set(session())
    expect(summaryOnly.body).not.toHaveProperty('turns')
  })

  it('applies energy −1 to every fighter that fought and Resting at 0; posts one update on the winner', async () => {
    const { monday, repos, start, deliver } = await setup()
    monday.pokemon.get('p3')!.energy = 1 // Squirtle will drop to 0
    const { battleId } = await start()
    await deliver()

    expect(monday.pokemon.get('p1')).toMatchObject({ energy: 2, status: 'Ready' }) // Charmander 3 → 2
    expect(monday.pokemon.get('p3')).toMatchObject({ energy: 0, status: 'Resting' })
    expect(monday.pokemon.get('p2')!.energy).toBe(2) // Training: didn't fight, untouched

    const doc = (await repos.battles.get(battleId))!
    const winnerId = doc.outcome!.winner === 'A' ? 'g1' : 'g2'
    expect(monday.updates).toEqual([{ itemId: winnerId, body: battleSummaryText(doc) }])
  })

  it('handles a redelivered message once', async () => {
    const { monday, start, deliver, repos } = await setup()
    const { battleId } = await start()
    await deliver()
    const turns = (await repos.battleTurns.list(battleId)).length
    const second = await deliver()

    expect(second.status).toBe(200)
    expect(monday.writes.filter((w) => w.itemId === 'p1')).toHaveLength(1)
    expect(monday.updates).toHaveLength(1)
    expect(await repos.battleTurns.list(battleId)).toHaveLength(turns)
  })

  it('resumes after a crash between turns and board apply, without lowering energy twice', async () => {
    const { monday, start, deliver, repos } = await setup()
    const { battleId } = await start()
    monday.failNextWrites(1)

    expect((await deliver()).status).toBe(500) // the queue will retry
    const crashed = (await repos.battles.get(battleId))!
    expect(crashed.snapshot).toBeDefined()
    expect(crashed.boardAppliedAt).toBeUndefined()

    expect((await deliver()).status).toBe(200) // the retry
    expect(monday.pokemon.get('p1')!.energy).toBe(2) // 3 → 2 once, from the snapshot
    expect(monday.updates).toHaveLength(1)
    expect((await repos.battles.get(battleId))!.status).toBe('done')
  })

  it('a duplicate that arrives while the battle is still running → 503 so the queue retries later', async () => {
    const { start, deliver, repos } = await setup()
    const { battleId } = await start()
    await repos.battles.claim(battleId) // another delivery is working on it right now
    expect((await deliver()).status).toBe(503)
  })

  it('a stuck run (claimed > 5 minutes ago) can be claimed again', async () => {
    const { start, deliver, repos, tick } = await setup()
    const { battleId } = await start()
    await repos.battles.claim(battleId)
    tick(6 * 60 * 1000)
    expect((await deliver()).status).toBe(200)
    expect((await repos.battles.get(battleId))!.status).toBe('done')
  })

  it('poison messages (garbage, unknown battle) are acknowledged with 200 and logged', async () => {
    const { deliver, events } = await setup()
    expect((await deliver('not json')).status).toBe(200)
    expect((await deliver(JSON.stringify({ v: 1, battleId: 'nope', traceId: 't' }))).status).toBe(200)
    expect(events().filter((e) => e.kind === 'queue').map((e) => e.poison)).toEqual(['UNPARSEABLE', 'UNKNOWN_BATTLE'])
  })

  it('a QuotaError from Mongo fails the battle with status failed and error QUOTA', async () => {
    const { start, deliver, repos } = await setup()
    const { battleId } = await start()
    vi.spyOn(repos.battleTurns, 'upsertMany').mockRejectedValue(new QuotaError(new Error('PERMISSION_DENIED')))
    expect((await deliver()).status).toBe(200) // retrying won't help until tomorrow
    expect(await repos.battles.get(battleId)).toMatchObject({ status: 'failed', error: 'QUOTA' })
  })

  it('queue and http events of one battle share the traceId and battleId', async () => {
    const { start, deliver, events } = await setup()
    const { battleId } = await start()
    await deliver()
    const http = events().find((e) => e.kind === 'http' && e.path === '/api/battles')
    const queue = events().find((e) => e.kind === 'queue')
    expect(http).toMatchObject({ battleId })
    expect(queue).toMatchObject({ battleId, traceId: http.traceId, result: 'done' })
  })

  it('logs the Pub/Sub delivery attempt on the queue event', async () => {
    const { app, start, queue, events } = await setup()
    await start()
    // Seen live (verify-early §17): monday code delivers through Pub/Sub push with this header
    await request(app).post(`/mndy-queue?secret=${queue.secret}`)
      .set('Content-Type', 'application/json').set('x-goog-pubsub-delivery-attempt', '3')
      .send(queue.published.at(-1)!)
    expect(events().find((e) => e.kind === 'queue')).toMatchObject({ deliveryAttempt: 3 })
  })
})

describe('GET /api/battles', () => {
  it('GET /api/battles/:id from another account → 404', async () => {
    const { app, start } = await setup()
    const { battleId } = await start()
    expect((await request(app).get(`/api/battles/${battleId}`).set(session(555, 999))).status).toBe(404)
    expect((await request(app).get('/api/battles/nope').set(session())).status).toBe(404)
  })

  it('lists recent battles of the user\'s gyms board, newest first', async () => {
    const { app, start, tick } = await setup()
    const first = await start()
    tick(1000)
    const second = await start('g2', 'g1')
    const res = await request(app).get('/api/battles?limit=10').set(session())
    expect(res.status).toBe(200)
    expect(res.body.battles.map((b: { _id: string }) => b._id)).toEqual([second.battleId, first.battleId])
    expect(res.body.battles[0]).not.toHaveProperty('snapshot')
  })
})

describe('parseQueueBody', () => {
  it('accepts raw JSON and a base64 Pub/Sub envelope', () => {
    const msg = { v: 1, battleId: 'b1', traceId: 't1' }
    expect(parseQueueBody(JSON.stringify(msg))).toEqual(msg)
    const envelope = { message: { data: Buffer.from(JSON.stringify(msg)).toString('base64'), messageId: '123' }, subscription: 's' }
    expect(parseQueueBody(JSON.stringify(envelope))).toEqual(msg)
  })

  it('throws on anything else', () => {
    expect(() => parseQueueBody('nope')).toThrow()
    expect(() => parseQueueBody(JSON.stringify({ v: 2, battleId: 'b1' }))).toThrow()
  })
})

describe('battleSummaryText', () => {
  it('names the winner, the turns and the MVP, then one line per KO', () => {
    const doc = {
      gymA: { id: 'g1', name: 'Cinnabar Gym' }, gymB: { id: 'g2', name: 'Cerulean Gym' },
      outcome: { winner: 'A', endedBy: 'knockout', turnCount: 12, fought: [], survivorsA: 1, survivorsB: 0, mvp: { id: 'p1', name: 'Charmander', kos: 1, damage: 54 } },
      kos: [{ n: 12, attackerName: 'Charmander', defenderName: 'Squirtle' }],
    } as unknown as BattleDoc
    expect(battleSummaryText(doc).split('\n')).toEqual([
      'Cinnabar Gym vs Cerulean Gym — Cinnabar Gym wins (12 turns, MVP Charmander)',
      'Turn 12: Charmander knocked out Squirtle',
    ])
  })

  it('says draw', () => {
    const doc = {
      gymA: { id: 'g1', name: 'A Gym' }, gymB: { id: 'g2', name: 'B Gym' },
      outcome: { winner: 'draw', endedBy: 'turnLimit', turnCount: 300, fought: [], survivorsA: 1, survivorsB: 1, mvp: null }, kos: [],
    } as unknown as BattleDoc
    expect(battleSummaryText(doc)).toBe('A Gym vs B Gym — draw (300 turns)')
  })
})
