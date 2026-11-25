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

/** The Telegram Bot API, recording what the bot would send (the real one: src/telegram/api.ts). */
export function fakeTelegram() {
  const sent: { chatId: string; text: string }[] = []
  return {
    sent,
    sendMessage: async (chatId: string, text: string) => void sent.push({ chatId, text }),
    sendPhoto: async () => {},
    setWebhook: async () => {},
    setMyCommands: async () => {},
  }
}

/** Object storage in a Map (the real one: src/card/objectStorage.ts over the SDK). */
export function fakeObjectStorage() {
  const files = new Map<string, { content: Buffer; contentType: string }>()
  let failUploads = false
  return {
    files,
    failUploads: () => void (failUploads = true),
    async upload(name: string, content: Buffer, contentType: string) {
      if (failUploads) throw new Error('Object storage upload failed: OBJECT_STORAGE_BUCKET is not set (simulated)')
      files.set(name, { content, contentType })
    },
    async download(name: string) {
      return files.get(name) ?? null
    },
  }
}

/** add_file_to_update, recording what was attached (the real one: src/monday/files.ts). */
export function fakeMondayFiles() {
  const attached: { userId: string; updateId: string; file: Buffer; filename: string }[] = []
  return {
    attached,
    mondayFileFor: (userId: string) => async (updateId: string, file: Buffer, filename: string) =>
      void attached.push({ userId, updateId, file, filename }),
  }
}

/** The card deps for tests that don't look at cards: a tiny fake PNG, storage and uploads that just record. */
export function fakeCardDeps() {
  return {
    renderCard: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    objectStorage: fakeObjectStorage(),
    mondayFileFor: fakeMondayFiles().mondayFileFor,
  }
}
