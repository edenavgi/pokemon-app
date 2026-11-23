import { Logger, Queue, SecureStorage } from '@mondaycom/apps-sdk'
import type { GqlRequest } from '@app/api/boards/gateway'
import type { Id } from '@app/api/GameApi'
import { createPokeApi, fetchPokeApi, memoryPokeCache, type PokeApi } from '@app/api/pokeapi/loaders'
import { createMondayOAuth, type OAuthPort } from './auth/oauth'
import { TokenStore } from './auth/tokenStore'
import { mondayRequest, mondayRequestFor } from './monday/client'
import { loadConfig, type Config } from './config'
import { connectDb, ensureIndexes, type Database } from './db/mongo'
import { createRepos, type Repos } from './db/repos'
import type { LoggerPort } from './log/wideEvent'
import { createTelegramApi, type TelegramPort } from './telegram/api'

/**
 * Everything the app needs from the outside world. Routes receive it instead of
 * creating SDK clients themselves, so tests can pass fakes.
 * Later tasks add: kv, objectStorage.
 */

/** The part of the SDK Queue we use (monday code: Google Pub/Sub; locally: a POST to ourselves). */
export interface QueuePort {
  publishMessage(message: string): Promise<string>
  validateMessageSecret(secret: string): boolean
}
export interface Deps {
  config: Config
  logger: LoggerPort
  now: () => Date
  repos: Repos
  /** Each user's monday OAuth token (Secure Storage), refreshed when needed */
  tokens: TokenStore
  /** monday's OAuth token endpoint */
  oauth: OAuthPort
  /** monday GraphQL with a given access token (the OAuth callback checks me() with the new one) */
  mondayWithToken: (accessToken: string) => GqlRequest
  /** monday GraphQL as this user, with their stored OAuth token */
  mondayFor: (userId: Id) => GqlRequest
  /** PokéAPI for work done for this user (Task 13 caches it in their key-value Storage) */
  pokeApiFor: (userId: Id) => Pick<PokeApi, 'getMoveset' | 'getTypeChart' | 'getEvolution'>
  queue: QueuePort
  /** The Telegram Bot API (@eden_gym_bot) */
  telegram: TelegramPort
}

export const LOGGER_TAG = 'pokemon-server'

/** Reads the config, connects to Document DB and makes sure the indexes exist. */
export async function createRealDeps(logger: LoggerPort = new Logger(LOGGER_TAG)): Promise<{ deps: Deps; database: Database }> {
  const config = loadConfig()
  const database = await connectDb(config.mongoUri)
  await ensureIndexes(database.db)
  const now = () => new Date()
  const oauth = createMondayOAuth(config)
  const secure = new SecureStorage()
  const tokens = new TokenStore(
    { // SecureStorage takes a JsonValue; a StoredToken is plain JSON
      get: (key) => secure.get(key),
      set: (key, value) => secure.set(key, { ...value }),
      delete: (key) => secure.delete(key),
    },
    oauth,
    now,
  )
  const mondayWithToken = (accessToken: string) => mondayRequest(async () => accessToken)
  const mondayFor = (userId: Id) => mondayRequestFor(tokens, userId)
  const pokeApi = createPokeApi(fetchPokeApi, memoryPokeCache()) // per process until Task 13
  const queue = new Queue()
  return {
    deps: {
      config, logger, now, repos: createRepos(database.db, now), tokens, oauth, mondayWithToken,
      mondayFor, pokeApiFor: () => pokeApi, queue, telegram: createTelegramApi(config.telegramBotToken),
    },
    database,
  }
}
