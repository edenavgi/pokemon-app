import { EnvironmentVariablesManager, SecretsManager } from '@mondaycom/apps-sdk'

export interface Config {
  mondayClientId: string
  mondayClientSecret: string
  serverBaseUrl: string
  telegramBotToken: string
  telegramWebhookSecret: string
  telegramBotUsername: string
  /** Document DB (MongoDB). Set by monday code in the cloud; server/.env locally. */
  mongoUri: string
  port: number
}

/** Where config values come from. Tests pass a fake; production uses the monday code SDK. */
export interface ConfigSource {
  env(key: string): string | undefined
  secret(key: string): string | undefined
}

// Plain settings: `mapps code:env` in the cloud.
const ENV_KEYS = {
  mondayClientId: 'MONDAY_CLIENT_ID',
  serverBaseUrl: 'SERVER_BASE_URL',
  telegramBotUsername: 'TELEGRAM_BOT_USERNAME',
  // Provided by the platform (not `mapps code:env`), so it may live only in process.env
  mongoUri: 'MNDY_MONGODB_CONNECTION_STRING',
} as const

// Secrets: `mapps code:secret` in the cloud (stored encrypted, separately from env).
const SECRET_KEYS = {
  mondayClientSecret: 'MONDAY_CLIENT_SECRET',
  telegramBotToken: 'TELEGRAM_BOT_TOKEN',
  telegramWebhookSecret: 'TELEGRAM_WEBHOOK_SECRET',
} as const

const DEFAULT_PORT = 8080

const isPlatformKey = (key: string) => key === 'PORT' || key.startsWith('MNDY_')

/**
 * The real source. In the cloud the SDK managers read the files monday code mounts.
 * Locally (no K_SERVICE env var) the SDK managers read process.env themselves, which
 * `tsx --env-file=.env` fills from server/.env.
 * PORT and MNDY_* (e.g. the Document DB connection string) are injected by the runtime,
 * not set through `mapps code:env`, so they are also read from process.env.
 */
export function sdkConfigSource(): ConfigSource {
  const env = new EnvironmentVariablesManager()
  const secrets = new SecretsManager()
  const str = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : String(v))
  return {
    env: (key) => str(env.get(key)) ?? (isPlatformKey(key) ? str(process.env[key]) : undefined),
    secret: (key) => str(secrets.get(key)),
  }
}

/** Reads every setting once at startup. Throws one error that names every missing key. */
export function loadConfig(src: ConfigSource = sdkConfigSource()): Config {
  const missing: string[] = []
  const read = <K extends string>(keys: Record<K, string>, get: (key: string) => string | undefined) => {
    const out = {} as Record<K, string>
    for (const [field, key] of Object.entries(keys) as [K, string][]) {
      const value = get(key)
      if (value === undefined) missing.push(key)
      else out[field] = value
    }
    return out
  }

  const env = read(ENV_KEYS, (k) => src.env(k))
  const secrets = read(SECRET_KEYS, (k) => src.secret(k))
  if (missing.length > 0) throw new Error(`Missing config: ${missing.join(', ')}`)

  return { ...env, ...secrets, port: Number(src.env('PORT') ?? DEFAULT_PORT) }
}
