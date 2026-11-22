import { afterEach, describe, expect, it, vi } from 'vitest'

// The monday SDK inside the iframe, faked. openLinkInTab opens the tab but NEVER answers:
// that is what monday did in the live test (Task 5, Step 5).
const sdk = vi.hoisted(() => ({
  get: vi.fn(async (type: string) => ({ data: type === 'sessionToken' ? 'session-token' : {} })),
  execute: vi.fn((type: string) => (type === 'openLinkInTab' ? new Promise(() => {}) : Promise.resolve({ data: {} }))),
  listen: vi.fn(() => () => {}),
  storage: { getItem: vi.fn(), setItem: vi.fn(), deleteItem: vi.fn() },
}))
vi.mock('monday-sdk-js', () => ({ default: () => sdk }))
vi.mock('@mondaydotcomorg/api', () => ({ SeamlessApiClient: class { request = vi.fn() } }))

import { createMondayGameApi } from './index'

afterEach(() => vi.unstubAllGlobals())

describe('MondayGameApi.startMondayOAuth', () => {
  it('opens the authorize URL and returns without waiting for openLinkInTab', async () => {
    const authorizeUrl = 'https://auth.monday.com/oauth2/authorize?state=s'
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ authorizeUrl }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const started = createMondayGameApi().startMondayOAuth()
    const outcome = await Promise.race([started.then(() => 'returned'), new Promise((r) => setTimeout(() => r('stuck'), 200))])

    expect(outcome).toBe('returned')
    expect(sdk.execute).toHaveBeenCalledWith('openLinkInTab', { url: authorizeUrl })
    expect(new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get('authorization')).toBe('Bearer session-token')
  })
})
