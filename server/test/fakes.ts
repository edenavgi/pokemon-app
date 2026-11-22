// In-memory stand-ins for the platform, so tests never call monday, Telegram or PokéAPI.
// Each task adds the fakes it needs (secure storage, queue, Telegram, monday boards…).
import jwt from 'jsonwebtoken'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll } from 'vitest'
import type { Config } from '../src/config'
import { connectDb, ensureIndexes, type Database } from '../src/db/mongo'
import type { LoggerPort } from '../src/log/wideEvent'

export function fakeLogger() {
  const info: string[] = []
  const errors: { msg: string; error?: Error }[] = []
  const logger: LoggerPort = {
    info: (msg) => void info.push(msg),
    error: (msg, opts) => void errors.push({ msg, error: opts?.error }),
  }
  /** Every emitted line (info and error), parsed back from JSON. */
  const events = () => [...info, ...errors.map((e) => e.msg)].map((line) => JSON.parse(line))
  return { logger, info, errors, events }
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    mondayClientId: 'test-client-id',
    mondayClientSecret: 'test-client-secret',
    serverBaseUrl: 'https://server.test',
    telegramBotToken: 'test-bot-token',
    telegramWebhookSecret: 'test-webhook-secret',
    telegramBotUsername: 'test_bot',
    mongoUri: 'mongodb://unused-in-tests',
    port: 8080,
    ...overrides,
  }
}

/**
 * A sessionToken shaped like the one monday gives the app (`monday.get('sessionToken')`):
 * an HS256 JWT whose `dat` holds the user and account. Signed with `secret`.
 */
export function signSessionToken(
  secret: string,
  dat: Record<string, unknown> = { user_id: 101, account_id: 202 },
  opts: jwt.SignOptions = { expiresIn: '5m' },
): string {
  return jwt.sign({ dat }, secret, { algorithm: 'HS256', ...opts })
}

// One in-memory MongoDB per test file (a real mongod, started on first use).
let server: MongoMemoryServer | undefined
let dbCount = 0
afterAll(async () => {
  await server?.stop()
  server = undefined
})

/** A fresh, empty database with the real indexes, on the shared in-memory server. */
export async function testDb(): Promise<Database> {
  server ??= await MongoMemoryServer.create()
  const db = await connectDb(server.getUri(), `test-${process.pid}-${++dbCount}`)
  await ensureIndexes(db.db)
  return db
}

/** Secure Storage in a Map (the real one: @mondaycom/apps-sdk SecureStorage). */
export function fakeSecureStorage() {
  const map = new Map<string, unknown>()
  return {
    map,
    get: async <T>(key: string) => (map.has(key) ? (structuredClone(map.get(key)) as T) : null),
    set: async (key: string, value: unknown) => {
      map.set(key, structuredClone(value))
      return true
    },
    delete: async (key: string) => map.delete(key),
  }
}

/** An OAuth access token shaped like monday's: a JWT whose payload carries `exp` (seconds). */
export function fakeAccessToken(expSeconds: number, label = 'access'): string {
  return jwt.sign({ exp: expSeconds, label }, 'monday-side-secret')
}
