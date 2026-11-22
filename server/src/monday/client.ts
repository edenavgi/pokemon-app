// The server's way to send monday GraphQL: ApiClient with a user's OAuth token.
// It plugs into the shared board gateway (src/api/boards/gateway.ts) as its GqlRequest,
// so the server runs exactly the app's queries.
import { ApiClient } from '@mondaydotcomorg/api'
import type { GqlRequest } from '@app/api/boards/gateway'
import type { Id } from '@app/api/GameApi'
import type { TokenStore } from '../auth/tokenStore'
import { currentEvent } from '../log/wideEvent'

export const MONDAY_API_VERSION = '2026-10'

/** Wait for a rate limit only if it's short: a Telegram reply can't hang for a minute. */
export const MAX_RATE_LIMIT_WAIT_SECONDS = 10

/** monday said "too many requests" (HTTP 429 / complexity budget) and we stopped. */
export class RateLimitedError extends Error {
  constructor(readonly retryInSeconds: number) {
    super(`monday API rate limit: retry in ${retryInSeconds}s`)
    this.name = 'RateLimitedError'
  }
}

export interface ApiClientLike {
  request<T>(query: string, variables?: Record<string, unknown>): Promise<T>
}

const RATE_LIMIT_CODES = new Set(['COMPLEXITY_BUDGET_EXHAUSTED', 'RATE_LIMIT_EXCEEDED', 'ComplexityException'])

// graphql-request's ClientError: { response: { status, errors: [{ extensions: { code, retry_in_seconds } }] } }
// → seconds to wait, or undefined when it isn't a rate limit
function rateLimitSeconds(err: unknown): number | undefined {
  const response = (err as { response?: { status?: number; errors?: { extensions?: Record<string, unknown> }[]; retry_in_seconds?: unknown } })?.response
  if (!response) return undefined
  const ext = response.errors?.find((e) => RATE_LIMIT_CODES.has(String(e.extensions?.code)))?.extensions
  if (response.status !== 429 && !ext) return undefined
  const seconds = Number(ext?.retry_in_seconds ?? response.retry_in_seconds ?? 1)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 1
}

export interface MondayRequestOptions {
  createClient?: (cfg: { token: string; apiVersion: string }) => ApiClientLike
  sleep?: (ms: number) => Promise<void>
}

/**
 * A GqlRequest that gets its token from `getToken` on every request (so a refreshed token
 * is picked up), counts calls on the wide event, and retries ONCE after a short rate limit.
 */
export function mondayRequest(getToken: () => Promise<string>, opts: MondayRequestOptions = {}): GqlRequest {
  const createClient = opts.createClient ?? ((cfg) => new ApiClient(cfg) as unknown as ApiClientLike)
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))

  return async <T,>(query: string, variables?: Record<string, unknown>): Promise<T> => {
    const client = createClient({ token: await getToken(), apiVersion: MONDAY_API_VERSION })
    currentEvent()?.inc('mondayCalls')
    try {
      return await client.request<T>(query, variables)
    } catch (err) {
      const wait = rateLimitSeconds(err)
      if (wait === undefined) throw err
      currentEvent()?.set({ mondayRateLimited: wait })
      if (wait > MAX_RATE_LIMIT_WAIT_SECONDS) throw new RateLimitedError(wait)
      await sleep(wait * 1000)
      currentEvent()?.inc('mondayCalls')
      try {
        return await client.request<T>(query, variables)
      } catch (again) {
        const waitAgain = rateLimitSeconds(again)
        if (waitAgain !== undefined) throw new RateLimitedError(waitAgain)
        throw again
      }
    }
  }
}

/** monday GraphQL as this user, with their stored (and refreshed) OAuth token. */
export function mondayRequestFor(tokens: TokenStore, userId: Id, opts?: MondayRequestOptions): GqlRequest {
  return mondayRequest(() => tokens.getAccessToken(userId), opts)
}
