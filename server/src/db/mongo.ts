// Document DB = MongoDB that monday code runs for the app. We use the official driver.
// Limits (per region, per day): 50k reads, 20k writes, 20k deletes, 1 GiB. Over the
// limit everything except deletes fails with PERMISSION_DENIED (→ QuotaError).
import { MongoClient, MongoServerError, type Db } from 'mongodb'

export interface Database {
  client: MongoClient
  db: Db
  close(): Promise<void>
}

/** Connects once at startup. `dbName` defaults to the database named in the URI. */
export async function connectDb(uri: string, dbName?: string): Promise<Database> {
  const client = new MongoClient(uri)
  await client.connect()
  return { client, db: client.db(dbName), close: () => client.close() }
}

/**
 * The indexes the game relies on. createIndex does nothing when the index already exists,
 * so this runs on every startup.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    // One Telegram chat per monday user (one-to-one with users)
    db.collection('links').createIndex({ userId: 1 }, { unique: true, name: 'userId_1' }),
    // The Arena lists recent battles of a board
    db.collection('battles').createIndex({ gymsBoardId: 1, createdAt: -1 }, { name: 'gymsBoardId_1_createdAt_-1' }),
    // A replay reads the turns of one battle in order
    db.collection('battle_turns').createIndex({ battleId: 1, n: 1 }, { name: 'battleId_1_n_1' }),
  ])
}

/** The daily Document DB quota is used up. Handlers turn this into a friendly "try again tomorrow". */
export class QuotaError extends Error {
  constructor(cause: unknown) {
    super('Document DB daily quota exceeded', { cause })
    this.name = 'QuotaError'
  }
}

const PERMISSION_DENIED = 13

/** Maps a driver error to our own error types (only the quota one so far). */
export function toDbError(err: unknown): unknown {
  if (err instanceof MongoServerError && (err.code === PERMISSION_DENIED || /PERMISSION_DENIED/.test(err.message))) {
    return new QuotaError(err)
  }
  return err
}
