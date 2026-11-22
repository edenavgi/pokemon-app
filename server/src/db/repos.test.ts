import { MongoServerError } from 'mongodb'
import { afterEach, describe, expect, it } from 'vitest'
import { testDb } from '../../test/fakes'
import { ensureIndexes, toDbError, QuotaError, type Database } from './mongo'
import { createRepos } from './repos'

let open: Database[] = []
async function setup() {
  const database = await testDb()
  open.push(database)
  let t = Date.parse('2026-11-22T10:00:00Z')
  const now = () => new Date(t)
  const tick = (ms: number) => (t += ms)
  return { database, repos: createRepos(database.db, now), now, tick }
}
afterEach(async () => {
  await Promise.all(open.map((d) => d.close()))
  open = []
})

describe('ensureIndexes', () => {
  it('is idempotent', async () => {
    const { database } = await setup()
    await ensureIndexes(database.db) // testDb() already ran it once
    const names = (await database.db.collection('links').indexes()).map((i) => i.name)
    expect(names).toContain('userId_1')
  })
})

describe('users', () => {
  it('upsert creates the user once and keeps createdAt on the next upsert', async () => {
    const { repos, tick } = await setup()
    await repos.users.upsert({ userId: '101', accountId: '202' })
    const first = await repos.users.get('101')
    tick(60_000)
    await repos.users.upsert({ userId: '101', accountId: '202' })
    const second = await repos.users.get('101')

    expect(second).toMatchObject({ _id: '101', accountId: '202' })
    expect(second?.createdAt).toEqual(first?.createdAt)
    expect(second!.updatedAt.getTime()).toBeGreaterThan(first!.updatedAt.getTime())
  })

  it('get returns null for an unknown user', async () => {
    const { repos } = await setup()
    expect(await repos.users.get('nobody')).toBeNull()
  })

  it('setBoards saves both board ids, and returns false when the user does not exist', async () => {
    const { repos } = await setup()
    expect(await repos.users.setBoards('101', { gymsBoardId: 'g', pokemonBoardId: 'p' })).toBe(false)
    expect(await repos.users.get('101')).toBeNull() // no user created by the attempt

    await repos.users.upsert({ userId: '101', accountId: '202' })
    expect(await repos.users.setBoards('101', { gymsBoardId: 'g', pokemonBoardId: 'p' })).toBe(true)
    expect(await repos.users.get('101')).toMatchObject({ gymsBoardId: 'g', pokemonBoardId: 'p' })
  })
})

describe('links', () => {
  it('links unique userId rejects a second chat for the same user', async () => {
    const { database } = await setup()
    const links = database.db.collection('links')
    await links.insertOne({ _id: 'chat-1' as never, userId: '101', accountId: '202', linkedAt: new Date() })
    await expect(
      links.insertOne({ _id: 'chat-2' as never, userId: '101', accountId: '202', linkedAt: new Date() }),
    ).rejects.toThrow(/duplicate key/)
  })

  it('getByUser finds the chat linked to a user', async () => {
    const { database, repos } = await setup()
    expect(await repos.links.getByUser('101')).toBeNull()
    await database.db.collection('links').insertOne({ _id: 'chat-1' as never, userId: '101', accountId: '202', linkedAt: new Date() })
    expect(await repos.links.getByUser('101')).toMatchObject({ _id: 'chat-1', userId: '101' })
  })
})

describe('toDbError', () => {
  it('turns PERMISSION_DENIED (code 13, the daily Document DB quota) into a QuotaError', () => {
    const err = new MongoServerError({ code: 13, codeName: 'Unauthorized', errmsg: 'PERMISSION_DENIED: quota exceeded' })
    expect(toDbError(err)).toBeInstanceOf(QuotaError)
  })

  it('leaves other errors alone', () => {
    const err = new Error('boom')
    expect(toDbError(err)).toBe(err)
  })
})
