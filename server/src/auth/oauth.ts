// OAuth 2.1 with PKCE against monday: the server gets its OWN token per user, so the bot and
// the cron job can act for them when they're not in monday.
//
//   app ──POST /api/oauth/start (sessionToken)──► server: new state + PKCE pair, saved in DB
//   browser ──► auth.monday.com/oauth2/authorize?…&state&code_challenge   (user approves)
//   monday ──► GET /oauth/callback?code&state ──► server: consume state, exchange code +
//              verifier, check me() is the same user, save the token, upsert the user
//
// state  : random, single-use, 10 minutes, bound to the user who started → no forged or replayed callbacks
// PKCE   : only the verifier's SHA-256 travels in the URL → a stolen code is useless without the verifier
// me()   : the token must belong to the user who started → never save one user's token for another
import { createHash, randomBytes } from 'node:crypto'
import type { RequestHandler, Response } from 'express'
import { createBoardGateway } from '@app/api/boards/gateway'
import type { Config } from '../config'
import type { Deps } from '../deps'
import type { WideEvent } from '../log/wideEvent'
import type { Session } from './sessionToken'
import { tokenFromResponse, type StoredToken } from './tokenStore'

export const AUTHORIZE_URL = 'https://auth.monday.com/oauth2/authorize'
export const TOKEN_URL = 'https://auth.monday.com/oauth_ms/oauth/token' // the OAuth 2.1 endpoint
export const STATE_TTL_MS = 10 * 60 * 1000

/** An error from monday's token endpoint, e.g. code "invalid_grant" (used or revoked refresh token). */
export class OAuthError extends Error {
  constructor(readonly code: string, message = `OAuth error: ${code}`) {
    super(message)
    this.name = 'OAuthError'
  }
}

/** The two calls to monday's token endpoint. Tests pass a fake. */
export interface OAuthPort {
  exchangeCode(code: string, verifier: string): Promise<StoredToken>
  refresh(refreshToken: string): Promise<StoredToken>
}

const randomUrlSafe = (bytes: number) => randomBytes(bytes).toString('base64url')

/** PKCE S256: challenge = base64url(SHA-256(verifier)). */
export const challengeFor = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')

/** A fresh verifier (32 random bytes → 43 chars) and its challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomUrlSafe(32)
  return { verifier, challenge: challengeFor(verifier) }
}

export const redirectUri = (config: Pick<Config, 'serverBaseUrl'>) =>
  `${config.serverBaseUrl.replace(/\/+$/, '')}/oauth/callback`

/** The real token endpoint, over fetch. JSON body, as in monday's OAuth 2.1 migration docs. */
export function createMondayOAuth(config: Config, fetchImpl: typeof fetch = fetch): OAuthPort {
  async function post(params: Record<string, string>): Promise<StoredToken> {
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: config.mondayClientId, client_secret: config.mondayClientSecret, ...params }),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) throw new OAuthError(typeof body.error === 'string' ? body.error : `http_${res.status}`)
    return tokenFromResponse(body)
  }
  return {
    exchangeCode: (code, verifier) =>
      post({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(config), code_verifier: verifier }),
    refresh: (refreshToken) => post({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  }
}

/** POST /api/oauth/start (behind requireSession) → { authorizeUrl } */
export function oauthStart(deps: Pick<Deps, 'config' | 'repos' | 'now'>): RequestHandler {
  return async (_req, res) => {
    const { userId, accountId } = res.locals.session as Session
    const state = randomUrlSafe(24)
    const { verifier, challenge } = pkcePair()
    await deps.repos.oauthStates.create({
      _id: state, userId, accountId, codeVerifier: verifier,
      expiresAt: new Date(deps.now().getTime() + STATE_TTL_MS),
    })
    const url = new URL(AUTHORIZE_URL)
    url.search = new URLSearchParams({
      client_id: deps.config.mondayClientId,
      redirect_uri: redirectUri(deps.config),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString()
    res.json({ authorizeUrl: url.toString() })
  }
}

// The callback is a page in the user's browser tab, so it answers with a small HTML page.
const PAGES = {
  connected: { status: 200, title: 'Connected', text: 'Pokémon Gym Manager is connected to monday. You can close this tab.' },
  declined: { status: 400, title: 'Not connected', text: 'Pokémon Gym Manager is not connected. You can close this tab and try again from the app.' },
  expired: { status: 400, title: 'Link expired', text: 'This link has expired or was already used, so monday is not connected. Start again from the app.' },
  failed: { status: 400, title: 'Not connected', text: 'monday did not accept the connection, so it is not connected. Start again from the app.' },
  wrongUser: { status: 403, title: 'Different monday user', text: 'You approved with a different monday user than the one who started, so nothing was saved and it is not connected. Start again from the app.' },
} as const

function page(res: Response, kind: keyof typeof PAGES) {
  const p = PAGES[kind]
  res.status(p.status).type('html').send(
    `<!doctype html><meta charset="utf-8"><title>${p.title}</title>` +
    `<body style="font-family:system-ui;padding:2rem"><h1>${p.title}</h1><p>${p.text}</p></body>`,
  )
}

/** GET /oauth/callback?code&state (or ?error&state when the user declines) */
export function oauthCallback(deps: Pick<Deps, 'repos' | 'tokens' | 'oauth' | 'mondayWithToken'>): RequestHandler {
  return async (req, res) => {
    const ev = res.locals.wideEvent as WideEvent | undefined
    const q = (name: string) => (typeof req.query[name] === 'string' ? (req.query[name] as string) : undefined)
    const state = q('state')
    const code = q('code')
    const outcome = (kind: keyof typeof PAGES, fields: Record<string, unknown> = {}) => {
      ev?.set({ oauth: kind, ...fields })
      page(res, kind)
    }

    // 1. The state must exist, be unexpired and unused. Consuming it deletes it: single use.
    if (!state) return outcome('expired')
    const pending = await deps.repos.oauthStates.consume(state)
    if (!pending) return outcome('expired')
    const who = { userId: pending.userId, accountId: pending.accountId }
    if (q('error') || !code) return outcome('declined', { ...who, mondayError: q('error') })

    // 2. code + the verifier only we know → the token
    let token: StoredToken
    try {
      token = await deps.oauth.exchangeCode(code, pending.codeVerifier)
    } catch (err) {
      return outcome('failed', { ...who, oauthError: err instanceof Error ? err.message : String(err) })
    }

    // 3. The token must belong to the user who started
    const me = await createBoardGateway(deps.mondayWithToken(token.accessToken)).me()
    if (me.userId !== pending.userId || me.accountId !== pending.accountId) {
      return outcome('wrongUser', { ...who, tokenUserId: me.userId, tokenAccountId: me.accountId })
    }

    // 4. Save the token (Secure Storage) and the user (Document DB)
    await deps.tokens.save(pending.userId, token)
    await deps.repos.users.upsert(who)
    outcome('connected', who)
  }
}
