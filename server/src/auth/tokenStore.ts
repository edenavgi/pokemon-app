// The server's monday OAuth tokens, one per monday user, in Secure Storage
// (secrets go to secret storage, never to the database, and never to the app or a log).
//
// OAuth 2.1 access tokens EXPIRE (read `exp` from the token itself: the response has no
// expires_in). The refresh token gets a new pair, and refresh tokens ROTATE: every refresh
// returns a new refresh token and the old one stops working.
import jwt from 'jsonwebtoken'
import type { Id } from '@app/api/GameApi'
import { OAuthError, type OAuthPort } from './oauth'

export interface StoredToken {
  accessToken: string
  refreshToken: string
  /** When the access token expires, in seconds since 1970 (the JWT's exp). */
  exp: number
}

/** The part of @mondaycom/apps-sdk SecureStorage we use. */
export interface SecureStoragePort {
  get<T>(key: string): Promise<T | null>
  set(key: string, value: StoredToken): Promise<unknown>
  delete(key: string): Promise<unknown>
}

/** The user must connect monday again from the app (no token, or it was revoked). */
export class ReconnectNeededError extends Error {
  constructor(readonly userId: Id) {
    super(`monday user ${userId} must connect again`)
    this.name = 'ReconnectNeededError'
  }
}

/** Refresh when less than this is left, so a token never expires in the middle of a request. */
export const REFRESH_MARGIN_SECONDS = 5 * 60

/** monday's token response → StoredToken. */
export function tokenFromResponse(body: Record<string, unknown>): StoredToken {
  const accessToken = body.access_token
  const refreshToken = body.refresh_token
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    throw new OAuthError('invalid_response', 'token response without access_token or refresh_token')
  }
  // decode = read the payload WITHOUT checking the signature. Fine here: the token came to us
  // directly from monday over HTTPS, and we only read the expiry. (Never use decode to trust a
  // token someone sent us — that's what verify is for, see sessionToken.ts.)
  const payload = jwt.decode(accessToken)
  const exp = typeof payload === 'object' && payload !== null ? payload.exp : undefined
  if (typeof exp !== 'number') throw new OAuthError('invalid_response', 'access token without exp')
  return { accessToken, refreshToken, exp }
}

const isInvalidGrant = (e: unknown) => e instanceof OAuthError && e.code === 'invalid_grant'

export class TokenStore {
  /** One refresh at a time per user; concurrent callers wait for the same one. */
  private readonly refreshing = new Map<Id, Promise<string>>()

  constructor(
    private readonly secure: SecureStoragePort,
    private readonly oauth: OAuthPort,
    private readonly now: () => Date,
  ) {}

  private key = (userId: Id) => `monday-token:${userId}`

  async save(userId: Id, token: StoredToken): Promise<void> {
    await this.secure.set(this.key(userId), token)
  }

  async has(userId: Id): Promise<boolean> {
    return (await this.secure.get<StoredToken>(this.key(userId))) !== null
  }

  async delete(userId: Id): Promise<void> {
    await this.secure.delete(this.key(userId))
  }

  /** A usable access token for the user, refreshed first if it expires within 5 minutes. */
  async getAccessToken(userId: Id): Promise<string> {
    const token = await this.read(userId)
    if (!this.expiresSoon(token)) return token.accessToken

    let running = this.refreshing.get(userId)
    if (!running) {
      running = this.refresh(userId, token).finally(() => this.refreshing.delete(userId))
      this.refreshing.set(userId, running)
    }
    return running
  }

  private async read(userId: Id): Promise<StoredToken> {
    const token = await this.secure.get<StoredToken>(this.key(userId))
    if (!token) throw new ReconnectNeededError(userId)
    return token
  }

  private expiresSoon(token: StoredToken): boolean {
    return token.exp - this.now().getTime() / 1000 < REFRESH_MARGIN_SECONDS
  }

  private async rotate(userId: Id, token: StoredToken): Promise<string> {
    const next = await this.oauth.refresh(token.refreshToken)
    await this.save(userId, next) // store the NEW pair at once: the old refresh token is dead now
    return next.accessToken
  }

  private async refresh(userId: Id, token: StoredToken): Promise<string> {
    try {
      return await this.rotate(userId, token)
    } catch (err) {
      if (!isInvalidGrant(err)) throw err // network trouble etc.: not a reason to reconnect
    }
    // invalid_grant: maybe another server instance rotated the token a moment ago.
    // Its new pair is in Secure Storage, so read again.
    const again = await this.read(userId)
    if (again.refreshToken === token.refreshToken) throw new ReconnectNeededError(userId) // really revoked
    if (!this.expiresSoon(again)) return again.accessToken
    try {
      return await this.rotate(userId, again)
    } catch (err) {
      if (isInvalidGrant(err)) throw new ReconnectNeededError(userId)
      throw err
    }
  }
}
