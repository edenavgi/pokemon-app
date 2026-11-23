// Typed access to each Document DB collection. Routes use these, never raw collections.
// Later tasks add more collections and methods (link codes, OAuth states, battles…).
import type { AnyBulkWriteOperation, Db } from 'mongodb'
import type { BoardConfig, Id } from '@app/api/GameApi'
import type { ArenaTurn } from '@app/game/arena'
import type { BattleDoc } from '../battle/service'
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

/** An OAuth login in progress: single use, 10 minutes. */
export interface OAuthStateDoc {
  _id: string // the state sent to monday
  userId: Id
  accountId: Id
  codeVerifier: string // PKCE: stays on the server, only its hash goes to monday
  expiresAt: Date
}

/** One Telegram chat ↔ one monday user. */
export interface LinkDoc {
  _id: string // Telegram chat id
  userId: Id
  accountId: Id
  linkedAt: Date
}

/** A one-time Telegram link code (Task 9). Only its sha256 is stored, as the _id. */
export interface LinkCodeDoc {
  _id: string // hashCode(code)
  userId: Id
  accountId: Id
  expiresAt: Date
}

/** A Telegram update we already handled (Telegram may deliver one twice). Kept 24 h. */
export interface TgUpdateDoc {
  _id: number // update_id
  at: Date
}
export const TG_UPDATE_KEEP_MS = 24 * 60 * 60 * 1000
const DUPLICATE_KEY = 11000

/** One saved turn: the engine's ArenaTurn + which battle it belongs to. */
export interface TurnDoc extends ArenaTurn {
  _id: string // "<battleId>:<n>" — the same turn always gets the same id, so a re-run overwrites it
  battleId: string
}

/** A battle claimed longer ago than this is considered stuck (its worker crashed) and may be claimed again. */
export const BATTLE_CLAIM_STALE_MS = 5 * 60 * 1000

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
  const oauthStates = database.collection<OAuthStateDoc>('oauth_states')
  const linkCodes = database.collection<LinkCodeDoc>('link_codes')
  const tgUpdates = database.collection<TgUpdateDoc>('tg_updates')
  const battles = database.collection<BattleDoc>('battles')
  const battleTurns = database.collection<TurnDoc>('battle_turns')

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

    oauthStates: {
      async create(doc: OAuthStateDoc): Promise<void> {
        // Old, never-used states are cleaned up here (deletes are the cheap part of the quota)
        await db(oauthStates.deleteMany({ expiresAt: { $lte: now() } }))
        await db(oauthStates.insertOne(doc))
      },

      /** The state if it exists and hasn't expired — and deletes it in the same step (single use). */
      consume(state: string): Promise<OAuthStateDoc | null> {
        return db(oauthStates.findOneAndDelete({ _id: state, expiresAt: { $gt: now() } }))
      },
    },

    battles: {
      async insert(doc: BattleDoc): Promise<void> {
        await db(battles.insertOne(doc))
      },

      get(battleId: string): Promise<BattleDoc | null> {
        return db(battles.findOne({ _id: battleId }))
      },

      /**
       * Atomically takes the battle for this worker: queued → running. Also takes a battle whose
       * claim is stale (the worker died). null = someone else is running it right now, or it's over.
       */
      claim(battleId: string): Promise<BattleDoc | null> {
        const at = now()
        return db(battles.findOneAndUpdate(
          {
            _id: battleId,
            $or: [
              { status: 'queued' },
              { status: 'running', claimedAt: { $lt: new Date(at.getTime() - BATTLE_CLAIM_STALE_MS) } },
            ],
          },
          { $set: { status: 'running', claimedAt: at } },
          { returnDocument: 'after' },
        ))
      },

      /** Gives a running battle back (after an error), so the queue's retry can claim it at once. */
      async release(battleId: string): Promise<void> {
        await db(battles.updateOne({ _id: battleId, status: 'running' }, { $set: { status: 'queued' }, $unset: { claimedAt: '' } }))
      },

      async update(battleId: string, fields: Partial<BattleDoc>): Promise<void> {
        await db(battles.updateOne({ _id: battleId }, { $set: fields }))
      },

      /** The newest battles of one Gyms board (the Arena's list). */
      recentForBoard(gymsBoardId: Id, limit: number): Promise<BattleDoc[]> {
        return db(battles.find({ gymsBoardId }).sort({ createdAt: -1 }).limit(limit).toArray())
      },
    },

    battleTurns: {
      /** Saves turns by their fixed ids, so writing the same turns again changes nothing. */
      async upsertMany(battleId: string, turns: ArenaTurn[]): Promise<void> {
        if (turns.length === 0) return
        const ops: AnyBulkWriteOperation<TurnDoc>[] = turns.map((t) => ({
          replaceOne: { filter: { _id: `${battleId}:${t.n}` }, replacement: { _id: `${battleId}:${t.n}`, battleId, ...t }, upsert: true },
        }))
        await db(battleTurns.bulkWrite(ops, { ordered: false }))
      },

      /** All turns of a battle, in order, as the engine produced them. */
      async list(battleId: string): Promise<ArenaTurn[]> {
        const docs = await db(battleTurns.find({ battleId }).sort({ n: 1 }).toArray())
        return docs.map(({ _id: _omitId, battleId: _omitBattle, ...turn }) => turn)
      },
    },

    links: {
      getByUser(userId: Id): Promise<LinkDoc | null> {
        return db(links.findOne({ userId }))
      },

      get(chatId: string): Promise<LinkDoc | null> {
        return db(links.findOne({ _id: chatId }))
      },

      /** Links the chat to the user. A user has one chat: their old chat (if any) is unlinked first. */
      async replaceForUser(l: { chatId: string; userId: Id; accountId: Id }): Promise<void> {
        await db(links.deleteMany({ userId: l.userId, _id: { $ne: l.chatId } }))
        await db(links.replaceOne(
          { _id: l.chatId },
          { userId: l.userId, accountId: l.accountId, linkedAt: now() },
          { upsert: true },
        ))
      },
    },

    linkCodes: {
      /** Saves a new code and drops the user's older codes and every expired one. */
      async create(doc: LinkCodeDoc): Promise<void> {
        await db(linkCodes.deleteMany({ $or: [{ userId: doc.userId }, { expiresAt: { $lte: now() } }] }))
        await db(linkCodes.insertOne(doc))
      },

      /** The code if it exists and hasn't expired — deleted in the same step (single use). */
      consume(hash: string): Promise<LinkCodeDoc | null> {
        return db(linkCodes.findOneAndDelete({ _id: hash, expiresAt: { $gt: now() } }))
      },
    },

    tgUpdates: {
      /** true the first time an update_id is seen; false for a redelivery. Forgets ids older than 24 h. */
      async markNew(updateId: number): Promise<boolean> {
        const at = now()
        await db(tgUpdates.deleteMany({ at: { $lt: new Date(at.getTime() - TG_UPDATE_KEEP_MS) } }))
        try {
          await db(tgUpdates.insertOne({ _id: updateId, at }))
          return true
        } catch (err) {
          if ((err as { code?: number }).code === DUPLICATE_KEY) return false
          throw err
        }
      },
    },
  }
}
