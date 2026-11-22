import jwt from 'jsonwebtoken'
import { describe, expect, it } from 'vitest'
import { signSessionToken } from '../../test/fakes'
import { AuthError, verifySessionToken } from './sessionToken'

const SECRET = 'client-secret'

describe('verifySessionToken', () => {
  it('accepts a valid token and returns user and account as strings', () => {
    const token = signSessionToken(SECRET, { user_id: 101, account_id: 202, app_id: 12741439 })
    expect(verifySessionToken(token, SECRET)).toEqual({ userId: '101', accountId: '202' })
  })

  it('rejects a wrong secret', () => {
    const token = signSessionToken('someone-elses-secret')
    expect(() => verifySessionToken(token, SECRET)).toThrow(AuthError)
  })

  it('rejects an expired token', () => {
    const token = signSessionToken(SECRET, undefined, { expiresIn: -10 })
    expect(() => verifySessionToken(token, SECRET)).toThrow(AuthError)
  })

  it('rejects a token without dat.user_id or dat.account_id', () => {
    expect(() => verifySessionToken(signSessionToken(SECRET, { account_id: 202 }), SECRET)).toThrow(AuthError)
    expect(() => verifySessionToken(signSessionToken(SECRET, { user_id: 101 }), SECRET)).toThrow(AuthError)
  })

  it('rejects an unsigned token (alg "none")', () => {
    const unsigned = jwt.sign({ dat: { user_id: 101, account_id: 202 } }, '', { algorithm: 'none' })
    expect(() => verifySessionToken(unsigned, SECRET)).toThrow(AuthError)
  })

  it('rejects garbage', () => {
    expect(() => verifySessionToken('not-a-jwt', SECRET)).toThrow(AuthError)
  })
})
