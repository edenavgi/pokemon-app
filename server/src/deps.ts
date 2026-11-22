import { Logger } from '@mondaycom/apps-sdk'
import { loadConfig, type Config } from './config'
import { connectDb, ensureIndexes, type Database } from './db/mongo'
import { createRepos, type Repos } from './db/repos'
import type { LoggerPort } from './log/wideEvent'

/**
 * Everything the app needs from the outside world. Routes receive it instead of
 * creating SDK clients themselves, so tests can pass fakes.
 * Later tasks add: tokens, queue, kv, telegram, monday, objectStorage.
 */
export interface Deps {
  config: Config
  logger: LoggerPort
  now: () => Date
  repos: Repos
}

export const LOGGER_TAG = 'pokemon-server'

/** Reads the config, connects to Document DB and makes sure the indexes exist. */
export async function createRealDeps(logger: LoggerPort = new Logger(LOGGER_TAG)): Promise<{ deps: Deps; database: Database }> {
  const config = loadConfig()
  const database = await connectDb(config.mongoUri)
  await ensureIndexes(database.db)
  const now = () => new Date()
  return { deps: { config, logger, now, repos: createRepos(database.db, now) }, database }
}
