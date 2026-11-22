import { Logger } from '@mondaycom/apps-sdk'
import { loadConfig, type Config } from './config'
import type { LoggerPort } from './log/wideEvent'

/**
 * Everything the app needs from the outside world. Routes receive it instead of
 * creating SDK clients themselves, so tests can pass fakes.
 * Later tasks add: db, tokens, queue, kv, telegram, monday, objectStorage.
 */
export interface Deps {
  config: Config
  logger: LoggerPort
  now: () => Date
}

export const LOGGER_TAG = 'pokemon-server'

export function createRealDeps(logger: LoggerPort = new Logger(LOGGER_TAG)): Deps {
  return { config: loadConfig(), logger, now: () => new Date() }
}
