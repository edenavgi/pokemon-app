import { describe, expect, it } from 'vitest'
import { loadConfig } from './config'

const ENV = {
  MONDAY_CLIENT_ID: 'client-id',
  SERVER_BASE_URL: 'https://server.test',
  TELEGRAM_BOT_USERNAME: 'eden_gym_bot',
  MNDY_MONGODB_CONNECTION_STRING: 'mongodb://localhost:27017/pokemon',
}
const SECRETS = {
  MONDAY_CLIENT_SECRET: 'client-secret',
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
}
const source = (env: Record<string, string>, secrets: Record<string, string>) => ({
  env: (k: string) => env[k],
  secret: (k: string) => secrets[k],
})

describe('loadConfig', () => {
  it('reads secrets from secret() and env from env()', () => {
    expect(loadConfig(source(ENV, SECRETS))).toEqual({
      mondayClientId: 'client-id',
      serverBaseUrl: 'https://server.test',
      telegramBotUsername: 'eden_gym_bot',
      mondayClientSecret: 'client-secret',
      telegramBotToken: 'bot-token',
      telegramWebhookSecret: 'webhook-secret',
      mongoUri: 'mongodb://localhost:27017/pokemon',
      port: 8080,
    })
  })

  it('reads PORT from env', () => {
    expect(loadConfig(source({ ...ENV, PORT: '9090' }, SECRETS)).port).toBe(9090)
  })

  it('requires the Document DB connection string', () => {
    const { MNDY_MONGODB_CONNECTION_STRING: _uri, ...rest } = ENV
    expect(() => loadConfig(source(rest, SECRETS))).toThrow(/MNDY_MONGODB_CONNECTION_STRING/)
  })

  it('names all missing keys', () => {
    const { MONDAY_CLIENT_SECRET: _a, TELEGRAM_BOT_TOKEN: _b, ...rest } = SECRETS
    expect(() => loadConfig(source(ENV, rest))).toThrow(/Missing config: .*MONDAY_CLIENT_SECRET.*TELEGRAM_BOT_TOKEN/)
  })

  it('does not accept a secret from env()', () => {
    const { TELEGRAM_BOT_TOKEN: token, ...rest } = SECRETS
    expect(() => loadConfig(source({ ...ENV, TELEGRAM_BOT_TOKEN: token }, rest))).toThrow(/TELEGRAM_BOT_TOKEN/)
  })
})
