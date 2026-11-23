import { describe, expect, it } from 'vitest'
import { hashCode, LINK_CODE_TTL_MS, newLinkCode } from './linking'

describe('link codes', () => {
  it('newLinkCode is 43 chars of [A-Za-z0-9_-] and differs each call', () => {
    const codes = new Set(Array.from({ length: 50 }, () => newLinkCode()))
    expect(codes.size).toBe(50)
    for (const c of codes) expect(c).toMatch(/^[A-Za-z0-9_-]{43}$/) // 32 random bytes, base64url
  })

  it('hashCode is the sha256 hex of the code (only the hash is stored)', () => {
    expect(hashCode('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('a code lives 10 minutes', () => {
    expect(LINK_CODE_TTL_MS).toBe(10 * 60 * 1000)
  })
})
