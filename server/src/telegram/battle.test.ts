// /battle from Telegram (Task 15): the webhook starts the battle through the same startBattle as the app,
// the queue runs it with the same engine, and the result goes back to the chat that asked — once.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import type { Move } from '@app/api/GameApi'
import { TYPE_CHART } from '@app/api/mock/fixtures'
import { battleErrorText } from '@app/lib/messages'
import { session, telegramSetup } from '../../test/telegramHarness'
import { battleSummaryText } from '../battle/service'
import { TelegramError } from './api'
import { texts } from './texts'

const MOVES: Record<number, Move[]> = {
  4: [{ name: 'Scratch', type: 'Normal', power: 40 }, { name: 'Ember', type: 'Fire', power: 40 }],
  7: [{ name: 'Tackle', type: 'Normal', power: 40 }, { name: 'Water Gun', type: 'Water', power: 40 }],
}
const pokeApi = () => ({
  getMoveset: async (dex: number) => MOVES[dex] ?? [],
  getTypeChart: async () => TYPE_CHART,
  getEvolution: async () => { throw new Error('not used in battles') },
  getSpecies: async () => { throw new Error('not used in battles') },
})

// These tests check the text messages (Task 15), so no card is drawn here; the card path: src/card/card.test.ts
const noCard = async (): Promise<Buffer> => { throw new Error('no card in the Task 15 tests') }

async function setup() {
  const s = await telegramSetup({ pokeApiFor: pokeApi, renderCard: noCard })
  await s.linkedChat('555', '101')
  /** What monday code does with a queue message: POST it to /mndy-queue with the secret. */
  const deliver = (body = s.queue.published.at(-1)!) =>
    request(s.app).post(`/mndy-queue?secret=${s.queue.secret}`).set('Content-Type', 'application/json').send(body)
  const battleId = () => JSON.parse(s.queue.published.at(-1)!).battleId as string
  return { ...s, deliver, battleId }
}

describe('/battle', () => {
  it('/battle Cinnabar Cerulean replies at once and publishes one message', async () => {
    const { say, repliesTo, queue, repos, battleId } = await setup()
    await say('555', '/battle Cinnabar Cerulean')

    expect(repliesTo('555')).toEqual([texts.battleStarted('Cinnabar Gym', 'Cerulean Gym')])
    expect(queue.published).toHaveLength(1)
    expect(await repos.battles.get(battleId())).toMatchObject({
      status: 'queued', source: 'telegram', chatId: '555', userId: '101', accountId: '202',
      gymA: { id: 'g1', name: 'Cinnabar Gym' }, gymB: { id: 'g2', name: 'Cerulean Gym' },
    })
  })

  it('the queue run sends the summary to the same chat once, even when redelivered', async () => {
    const { say, repliesTo, deliver, repos, battleId } = await setup()
    await say('555', '/battle Cinnabar Cerulean')
    expect((await deliver()).status).toBe(200)
    expect((await deliver()).status).toBe(200)

    const doc = (await repos.battles.get(battleId()))!
    expect(doc).toMatchObject({ status: 'done' })
    expect(doc.resultSentAt).toBeInstanceOf(Date)
    expect(repliesTo('555')).toEqual([texts.battleStarted('Cinnabar Gym', 'Cerulean Gym'), battleSummaryText(doc)])
  })

  it('board changes equal those of an app-started battle (same seed and fixture → same patches)', async () => {
    const tg = await setup()
    await tg.say('555', '/battle Cinnabar Cerulean')
    const seed = (await tg.repos.battles.get(tg.battleId()))!.seed
    await tg.deliver()

    const app = await setup()
    const res = await request(app.app).post('/api/battles').set(session('101')).send({ gymAId: 'g1', gymBId: 'g2' })
    await app.repos.battles.update(res.body.battleId, { seed })
    await app.deliver()

    expect(tg.monday.writes.length).toBeGreaterThan(0)
    expect(tg.monday.writes).toEqual(app.monday.writes)
    expect(tg.monday.updates).toEqual(app.monday.updates)
  })

  it('the battle appears in GET /api/battles for that board', async () => {
    const { app, say, deliver, battleId } = await setup()
    await say('555', '/battle Cinnabar Cerulean')
    await deliver()
    const res = await request(app).get('/api/battles').set(session('101'))
    expect(res.body.battles).toEqual([expect.objectContaining({ _id: battleId(), source: 'telegram', status: 'done' })])
  })

  it('the webhook, queue and Telegram-reply events share one traceId', async () => {
    const { say, deliver, log, battleId } = await setup()
    await say('555', '/battle Cinnabar Cerulean')
    await deliver()
    const webhook = log.events().find((e) => e.kind === 'http' && e.path === '/telegram/webhook')
    const queue = log.events().find((e) => e.kind === 'queue')
    expect(webhook).toMatchObject({ command: '/battle', battleId: battleId() })
    expect(queue).toMatchObject({ battleId: battleId(), traceId: webhook.traceId, result: 'done', resultSent: true })
  })

  it('/battle with one gym → usage; with an ambiguous split → the quote hint', async () => {
    const { say, repliesTo, monday, queue } = await setup()
    await say('555', '/battle Cinnabar')
    // "Cinnabar Gym Cerulean": both "Cinnabar | Gym Cerulean" fails, but rename a gym so two splits fit
    monday.gyms.get('g2')!.name = 'Gym Cerulean'
    monday.gyms.get('g3')!.name = 'Cerulean'
    await say('555', '/battle Cinnabar Gym Cerulean')
    expect(repliesTo('555')).toEqual([texts.usage('/battle <gym> <gym>'), texts.ambiguousSplit])
    expect(queue.published).toHaveLength(0)
  })

  it('a gym with no Ready Pokémon → the v1 text, nothing published', async () => {
    const { say, repliesTo, monday, queue } = await setup()
    monday.pokemon.get('p3')!.status = 'Resting' // Cerulean's only Ready Pokémon
    await say('555', '/battle Cinnabar Cerulean')
    expect(repliesTo('555')).toEqual([battleErrorText('B_NOT_ELIGIBLE')])
    expect(queue.published).toHaveLength(0)
  })

  it('a battle that fails in the queue tells the chat why, once', async () => {
    const { say, repliesTo, deliver, monday, repos, battleId } = await setup()
    await say('555', '/battle Cinnabar Cerulean')
    monday.pokemon.get('p3')!.status = 'Resting' // changed on the board before the queue ran it
    await deliver()
    await deliver()
    const doc = (await repos.battles.get(battleId()))!
    expect(doc).toMatchObject({ status: 'failed', error: 'B_NOT_ELIGIBLE' })
    expect(repliesTo('555').slice(1)).toEqual([texts.battleFailed('Cinnabar Gym', 'Cerulean Gym', 'B_NOT_ELIGIBLE')])
  })

  it('a temporary Telegram failure (5xx, 429, network) → 500 so the queue retries, then the summary is sent once', async () => {
    const { say, repliesTo, deliver, telegram, repos, monday, battleId } = await setup()
    await say('555', '/battle Cinnabar Cerulean')
    telegram.sendMessage.mockRejectedValueOnce(new TelegramError('sendMessage', 502, 'Bad Gateway'))
    expect((await deliver()).status).toBe(500)
    expect((await repos.battles.get(battleId()))!.status).toBe('queued')

    expect((await deliver()).status).toBe(200)
    const doc = (await repos.battles.get(battleId()))!
    expect(doc.status).toBe('done')
    expect(repliesTo('555').slice(1)).toEqual([battleSummaryText(doc)])
    expect(monday.updates).toHaveLength(2) // one per gym, not done twice
  })

  it('a permanent Telegram failure (user blocked the bot) → logged, battle done, no retry', async () => {
    const { say, deliver, telegram, repos, log, battleId } = await setup()
    await say('555', '/battle Cinnabar Cerulean')
    telegram.sendMessage.mockRejectedValueOnce(new TelegramError('sendMessage', 403, 'Forbidden: bot was blocked by the user'))
    expect((await deliver()).status).toBe(200)
    const doc = (await repos.battles.get(battleId()))!
    expect(doc.status).toBe('done')
    expect(doc.resultSentAt).toBeInstanceOf(Date)
    expect(log.events().find((e) => e.kind === 'queue')).toMatchObject({ resultNotSent: expect.stringContaining('403') })
  })

  it('an app-started battle sends nothing to Telegram', async () => {
    const { app, deliver, sent } = await setup()
    await request(app).post('/api/battles').set(session('101')).send({ gymAId: 'g1', gymBId: 'g2' })
    await deliver()
    expect(sent).toEqual([])
  })

  it('is in the command menu', async () => {
    const { BOT_COMMANDS } = await import('./commands')
    expect(BOT_COMMANDS.map((c) => c.command)).toContain('battle')
  })
})

describe('there is no battle logic in telegram/', () => {
  it('no file in server/src/telegram uses simulateArena', () => {
    const dir = join(__dirname)
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) expect(readFileSync(join(dir, f), 'utf8')).not.toMatch(/simulateArena/)
  })
})
