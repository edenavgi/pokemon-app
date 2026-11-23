// One-time link codes: the app asks for one, the user carries it to Telegram in a t.me deep link
// (https://t.me/<bot>?start=<code>), and /start <code> links that chat to the user who asked.
import { createHash, randomBytes } from 'node:crypto'

/** A code works for 10 minutes. */
export const LINK_CODE_TTL_MS = 10 * 60 * 1000

/**
 * 32 random bytes as base64url = 43 chars of [A-Za-z0-9_-], which is exactly what Telegram
 * allows in a /start parameter (max 64). 256 bits: guessing one is hopeless.
 */
export function newLinkCode(): string {
  return randomBytes(32).toString('base64url')
}

/** Only the hash is stored, so a database leak gives no usable codes. */
export function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}
