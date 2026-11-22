import { Logger, SecureStorage } from '@mondaycom/apps-sdk'
import type { GqlRequest } from '@app/api/boards/gateway'
import { createMondayOAuth, type OAuthPort } from './auth/oauth'
import { TokenStore } from './auth/tokenStore'
import { mondayRequest } from './monday/client'
import { loadConfig, type Config } from './config'
import { connectDb, ensureIndexes, type Database } from './db/mongo'
import { createRepos, type Repos } from './db/repos'
import type { LoggerPort } from './log/wideEvent'

/**
 * Everything the app needs from the outside world. Routes receive it instead of
 * creating SDK clients themselves, so tests can pass fakes.
 * Later tasks add: queue, kv, telegram, objectStorage.
 */
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
  return { deps: { config, logger, now, repos: createRepos(database.db, now), tokens, oauth, mondayWithToken }, database }
}
