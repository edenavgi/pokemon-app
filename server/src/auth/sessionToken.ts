// The app (in monday's iframe) proves who is calling with a sessionToken:
// monday.get('sessionToken') → a short-lived JWT, signed by monday with the app's secret,
// carrying dat.user_id and dat.account_id. Only monday and this server know the secret,
// so a valid signature means "this request really comes from that monday user".
// It is NOT an API token: it can't call monday's API. For that the server uses the
// user's OAuth token (Task 4).
import type { RequestHandler } from 'express'
import jwt from 'jsonwebtoken'
import type { Id } from '@app/api/GameApi'
import type { Deps } from '../deps'
import type { WideEvent } from '../log/wideEvent'

export interface Session {
  userId: Id
  accountId: Id
}

export type AuthFailure = 'MISSING_TOKEN' | 'EXPIRED' | 'INVALID_TOKEN' | 'MISSING_CLAIMS'

export class AuthError extends Error {
  constructor(readonly reason: AuthFailure) {
    super(`sessionToken rejected: ${reason}`)
    this.name = 'AuthError'
  }
}

/** Checks the signature (HS256 only), the expiry and the claims. Throws AuthError. */
export function verifySessionToken(token: string, secret: string): Session {
  let payload: string | jwt.JwtPayload
  try {
    // algorithms: never accept "none" or another algorithm chosen by the caller
    payload = jwt.verify(token, secret, { algorithms: ['HS256'] })
  } catch (err) {
    throw new AuthError(err instanceof jwt.TokenExpiredError ? 'EXPIRED' : 'INVALID_TOKEN')
  }
  const dat = typeof payload === 'object' ? (payload.dat as Record<string, unknown> | undefined) : undefined
  if (dat?.user_id == null || dat.account_id == null) throw new AuthError('MISSING_CLAIMS')
  return { userId: String(dat.user_id), accountId: String(dat.account_id) }
}

/**
 * Express middleware for every /api route: reads `Authorization: Bearer <sessionToken>`,
 * verifies it, and puts the Session on res.locals.session. Anything else → 401, and the
 * route handler never runs. The token itself is never logged; the event gets who called.
 */
export function requireSession(deps: Pick<Deps, 'config'>): RequestHandler {
  return (req, res, next) => {
    const ev = res.locals.wideEvent as WideEvent | undefined
    const header = req.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
    try {
      if (!token) throw new AuthError('MISSING_TOKEN')
      const session = verifySessionToken(token, deps.config.mondayClientSecret)
      res.locals.session = session
      ev?.set({ userId: session.userId, accountId: session.accountId })
      next()
    } catch (err) {
      if (!(err instanceof AuthError)) throw err
      ev?.set({ authError: err.reason })
      res.status(401).json({ error: 'UNAUTHORIZED' })
    }
  }
}
