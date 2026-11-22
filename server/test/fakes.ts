// In-memory stand-ins for the platform, so tests never call monday, Telegram or PokéAPI.
// Later tasks add more fakes here (secure storage, queue, Telegram, monday boards, test DB).
import type { Config } from '../src/config'
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
    port: 8080,
    ...overrides,
  }
}
