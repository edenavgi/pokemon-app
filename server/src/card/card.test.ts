// The battle card in a whole battle (Task 16): drawn after the update is posted, stored in Object storage,
// attached to the update, sent to Telegram as a photo with the summary as caption. Best effort throughout.
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { Move } from '@app/api/GameApi'
import { TYPE_CHART } from '@app/api/mock/fixtures'
import { session, telegramSetup } from '../../test/telegramHarness'
import { battleSummaryText, onBattleDone, type BattleDoc } from '../battle/service'
import { CAPTION_MAX, TelegramError } from '../telegram/api'
import { texts } from '../telegram/texts'
import { cardFileName } from './objectStorage'

const MOVES: Record<number, Move[]> = {
  4: [{ name: 'Scratch', type: 'Normal', power: 40 }, { name: 'Ember', type: 'Fire', power: 40 }],
  7: [{ name: 'Tackle', type: 'Normal', power: 40 }, { name: 'Water Gun', type: 'Water', power: 40 }],
}
const pokeApi = () => ({
  getMoveset: async (dex: number) => MOVES[dex] ?? [],
  getTypeChart: async () => TYPE_CHART,
  getEvolution: async () => { throw new Error('not used') },
  getSpecies: async () => { throw new Error('not used') },
})
const CARD = Buffer.from('a-card-png')

async function setup(renderCard: () => Promise<Buffer> = async () => CARD) {
  const s = await telegramSetup({ pokeApiFor: pokeApi, renderCard })
  await s.linkedChat('555', '101')
  const deliver = () =>
    request(s.app).post(`/mndy-queue?secret=${s.queue.secret}`).set('Content-Type', 'application/json').send(s.queue.published.at(-1)!)
  const battleId = () => JSON.parse(s.queue.published.at(-1)!).battleId as string
  const appBattle = () => request(s.app).post('/api/battles').set(session('101')).send({ gymAId: 'g1', gymBId: 'g2' })
  const queueEvent = () => s.log.events().find((e) => e.kind === 'queue')
  return { ...s, deliver, battleId, appBattle, queueEvent }
}

describe('the battle card', () => {
  it('uploads cards/<id>.png and attaches the same PNG to the update on each gym', async () => {
    const { appBattle, deliver, battleId, objectStorage, attached, monday, repos, queueEvent } = await setup()
    await appBattle()
    await deliver()

    expect(objectStorage.files.get(cardFileName(battleId()))).toEqual({ content: CARD, contentType: 'image/png' })
    const doc = (await repos.battles.get(battleId()))!
    expect(doc.status).toBe('done')
    expect(doc.cardAt).toBeInstanceOf(Date)
    expect(doc.updateIds).toEqual(['u1', 'u2']) // fakeMonday numbers its updates u1, u2…
    expect(monday.updates.map((u) => u.itemId)).toEqual(['g1', 'g2'])
    expect(attached).toEqual(['u1', 'u2'].map((updateId) => ({ userId: '101', updateId, file: CARD, filename: `battle-${battleId()}.png` })))
    expect(queueEvent()).toMatchObject({ cardBytes: CARD.length })
  })

  it('draws the gyms, the winner, the turns and the MVP with its sprite', async () => {
    const { appBattle, deliver, battleId, repos, deps } = await setup()
    await appBattle()
    await deliver()
    const doc = (await repos.battles.get(battleId()))!
    const o = doc.outcome!
    const mvpDex = doc.snapshot!.pokemon.find((p) => p.id === o.mvp!.id)!.dex
    expect(deps.renderCard).toHaveBeenCalledWith({
      gymA: 'Cinnabar Gym', gymB: 'Cerulean Gym', turns: o.turnCount,
      winner: o.winner === 'draw' ? null : (o.winner === 'A' ? doc.gymA : doc.gymB).name,
      mvp: { name: o.mvp!.name, spriteUrl: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${mvpDex}.png` },
    })
  })

  it('GET /api/battles/:id/card answers the PNG; another account or no card → 404', async () => {
    const { app, appBattle, deliver, battleId } = await setup()
    await appBattle()
    expect((await request(app).get(`/api/battles/${battleId()}/card`).set(session('101'))).status).toBe(404) // not run yet
    await deliver()

    const res = await request(app).get(`/api/battles/${battleId()}/card`).set(session('101')).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = []
      r.on('data', (c: Buffer) => chunks.push(c))
      r.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.body).toEqual(CARD)
    expect((await request(app).get(`/api/battles/${battleId()}/card`).set(session('101', '999'))).status).toBe(404)
  })

  it('a Telegram battle gets ONE message: the card with the summary as caption', async () => {
    const { say, deliver, battleId, repos, photos, repliesTo } = await setup()
    await say('555', '/battle Cinnabar Cerulean')
    await deliver()
    const doc = (await repos.battles.get(battleId()))!
    expect(photos).toEqual([{ chatId: '555', png: CARD, caption: battleSummaryText(doc) }])
    expect(repliesTo('555')).toEqual([texts.battleStarted('Cinnabar Gym', 'Cerulean Gym')]) // no separate text
    expect(doc.resultSentAt).toBeInstanceOf(Date)
  })

  it('card failure does not fail the battle: cardError on the doc and the event, Telegram gets the text', async () => {
    const { say, deliver, battleId, repos, objectStorage, attached, photos, repliesTo, queueEvent } = await setup(async () => {
      throw new Error('resvg exploded')
    })
    await say('555', '/battle Cinnabar Cerulean')
    expect((await deliver()).status).toBe(200)
    const doc = (await repos.battles.get(battleId()))!
    expect(doc).toMatchObject({ status: 'done', cardError: 'resvg exploded' })
    expect(queueEvent()).toMatchObject({ result: 'done', cardError: 'resvg exploded' })
    expect(objectStorage.files.size).toBe(0)
    expect(attached).toEqual([])
    expect(photos).toEqual([])
    expect(repliesTo('555').slice(1)).toEqual([battleSummaryText(doc)])
  })

  it('Object storage failing → cardError, nothing attached, but the Telegram photo still goes out', async () => {
    const { say, deliver, battleId, repos, objectStorage, attached, photos } = await setup()
    objectStorage.failUploads()
    await say('555', '/battle Cinnabar Cerulean')
    expect((await deliver()).status).toBe(200)
    const doc = (await repos.battles.get(battleId()))!
    expect(doc.status).toBe('done')
    expect(doc.cardError).toMatch(/OBJECT_STORAGE_BUCKET/)
    expect(attached).toEqual([])
    expect(photos).toHaveLength(1)
  })

  it('a redelivered message stores, attaches and sends the card once', async () => {
    const { say, deliver, deps, attached, photos } = await setup()
    await say('555', '/battle Cinnabar Cerulean')
    await deliver()
    await deliver()
    expect(deps.renderCard).toHaveBeenCalledTimes(1)
    expect(attached).toHaveLength(2)
    expect(photos).toHaveLength(1)
  })

  it('a temporary sendPhoto failure → the queue retries; the card is stored and attached once, the photo sent once', async () => {
    const { say, deliver, telegram, attached, photos, objectStorage } = await setup()
    await say('555', '/battle Cinnabar Cerulean')
    telegram.sendPhoto.mockRejectedValueOnce(new TelegramError('sendPhoto', 502, 'Bad Gateway'))
    expect((await deliver()).status).toBe(500)
    expect((await deliver()).status).toBe(200)
    expect(objectStorage.files.size).toBe(1)
    expect(attached).toHaveLength(2)
    expect(photos).toHaveLength(1)
  })

  it('a permanent sendPhoto failure (Telegram refuses the photo) → the text summary instead', async () => {
    const { say, deliver, telegram, battleId, repos, repliesTo, queueEvent } = await setup()
    await say('555', '/battle Cinnabar Cerulean')
    telegram.sendPhoto.mockRejectedValueOnce(new TelegramError('sendPhoto', 400, 'Bad Request: IMAGE_PROCESS_FAILED'))
    expect((await deliver()).status).toBe(200)
    const doc = (await repos.battles.get(battleId()))!
    expect(repliesTo('555').slice(1)).toEqual([battleSummaryText(doc)])
    expect(queueEvent()).toMatchObject({ resultSent: true, photoNotSent: expect.stringContaining('400') })
  })
})

describe('onBattleDone with a card', () => {
  const doc = (kos: number): BattleDoc => ({
    _id: 'b1', traceId: 't', source: 'telegram', chatId: '555', userId: '101', accountId: '202', gymsBoardId: 'gb',
    gymA: { id: 'g1', name: 'Cinnabar Gym' }, gymB: { id: 'g2', name: 'Cerulean Gym' }, seed: 1, status: 'running',
    outcome: { winner: 'A', endedBy: 'knockout', turnCount: kos, fought: [], mvp: null, survivorsA: 1, survivorsB: 0 },
    kos: Array.from({ length: kos }, (_, i) => ({ n: i + 1, attackerName: 'Charmander', defenderName: 'Squirtle' })),
    createdAt: new Date(),
  })
  const deps = () => {
    const calls: string[] = []
    return {
      calls,
      deps: {
        now: () => new Date(),
        repos: { battles: { update: vi.fn(async () => {}) } },
        telegram: {
          sendPhoto: vi.fn(async (_c: string, _p: Buffer, caption: string) => void calls.push(`photo:${caption}`)),
          sendMessage: vi.fn(async (_c: string, text: string) => void calls.push(`text:${text}`)),
        },
      } as unknown as Parameters<typeof onBattleDone>[0],
    }
  }

  it('a summary too long for a caption → the photo with the first line, then the full text', async () => {
    const long = doc(60)
    const summary = battleSummaryText(long)
    expect(summary.length).toBeGreaterThan(CAPTION_MAX)
    const { deps: d, calls } = deps()
    await onBattleDone(d, long, CARD)
    expect(calls).toEqual([`photo:${summary.split('\n')[0]}`, `text:${summary}`])
  })

  it('a failed battle sends the failure text, never the card', async () => {
    const { deps: d, calls } = deps()
    await onBattleDone(d, { ...doc(1), error: 'B_NOT_ELIGIBLE' }, CARD)
    expect(calls).toEqual([`text:${texts.battleFailed('Cinnabar Gym', 'Cerulean Gym', 'B_NOT_ELIGIBLE')}`])
  })
})
