// Typed access to each Document DB collection. Routes use these, never raw collections.
// Later tasks add more collections and methods (link codes, OAuth states, battles…).
import type { Db } from 'mongodb'
import type { BoardConfig, Id } from '@app/api/GameApi'
import { toDbError } from './mongo'

/** One document per monday user who connected the server (OAuth). */
export interface UserDoc {
  _id: Id // monday user id
  accountId: Id
  gymsBoardId?: Id
  pokemonBoardId?: Id
  createdAt: Date
  updatedAt: Date
}

/** One Telegram chat ↔ one monday user. */
export interface LinkDoc {
  _id: string // Telegram chat id
  userId: Id
  accountId: Id
  linkedAt: Date
}

// Every driver error goes through toDbError, so a full quota becomes a QuotaError
async function db<T>(op: Promise<T>): Promise<T> {
  try {
    return await op
  } catch (err) {
    throw toDbError(err)
  }
}

export type Repos = ReturnType<typeof createRepos>

export function createRepos(database: Db, now: () => Date) {
  const users = database.collection<UserDoc>('users')
  const links = database.collection<LinkDoc>('links')

  return {
    users: {
      /** Creates the user, or refreshes accountId/updatedAt. createdAt is set only once. */
      async upsert(u: { userId: Id; accountId: Id }): Promise<void> {
        const at = now()
        await db(users.updateOne(
          { _id: u.userId },
          { $set: { accountId: u.accountId, updatedAt: at }, $setOnInsert: { createdAt: at } },
          { upsert: true },
        ))
      },

      get(userId: Id): Promise<UserDoc | null> {
        return db(users.findOne({ _id: userId }))
      },

      /** Saves the user's game boards. false = no such user (they haven't connected yet). */
      async setBoards(userId: Id, cfg: BoardConfig): Promise<boolean> {
        const res = await db(users.updateOne(
          { _id: userId },
          { $set: { gymsBoardId: cfg.gymsBoardId, pokemonBoardId: cfg.pokemonBoardId, updatedAt: now() } },
        ))
        return res.matchedCount === 1
      },
    },

    links: {
      getByUser(userId: Id): Promise<LinkDoc | null> {
        return db(links.findOne({ userId }))
      },
    },
  }
}
