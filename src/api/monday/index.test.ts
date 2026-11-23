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

describe('MondayGameApi battles (the server)', () => {
  const doc = { _id: 'b1', traceId: 't', source: 'telegram', status: 'done', createdAt: '2026-11-23T09:00:00.000Z', gymA: { id: 'g1', name: 'A' }, gymB: { id: 'g2', name: 'B' } }
  const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }))
  const call = (f: ReturnType<typeof reply>, i = 0) => f.mock.calls[i] as unknown as [string, RequestInit]

  it('startBattle POSTs both gym ids to /api/battles', async () => {
    const f = reply({ battleId: 'b1' }, 202)
    vi.stubGlobal('fetch', f)
    expect(await createMondayGameApi().startBattle('g1', 'g2')).toEqual({ battleId: 'b1' })
    expect(call(f)[0]).toMatch(/\/api\/battles$/)
    expect(call(f)[1].method).toBe('POST')
    expect(JSON.parse(String(call(f)[1].body))).toEqual({ gymAId: 'g1', gymBId: 'g2' })
  })

  it('getBattle asks for the turns only when told, and maps _id to id', async () => {
    const f = reply({ battle: doc, turns: [] })
    vi.stubGlobal('fetch', f)
    const api = createMondayGameApi()
    const got = await api.getBattle('b1', { turns: true })
    expect(call(f)[0]).toMatch(/\/api\/battles\/b1\?turns=1$/)
    expect(got.battle).toMatchObject({ id: 'b1', source: 'telegram', status: 'done' })
    expect(got.turns).toEqual([])
    await api.getBattle('b1', { turns: false })
    expect(call(f, 1)[0]).toMatch(/\/api\/battles\/b1\?turns=0$/)
  })

  it('listBattles reads /api/battles?limit=', async () => {
    const f = reply({ battles: [doc] })
    vi.stubGlobal('fetch', f)
    const list = await createMondayGameApi().listBattles(5)
    expect(call(f)[0]).toMatch(/\/api\/battles\?limit=5$/)
    expect(list.map((b) => b.id)).toEqual(['b1'])
  })
})

describe('MondayGameApi.startTelegramLink', () => {
  it('asks the server for a link code and opens the t.me link without waiting for openLinkInTab', async () => {
    const url = 'https://t.me/eden_gym_bot?start=abc'
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ url }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const started = createMondayGameApi().startTelegramLink()
    const outcome = await Promise.race([started.then(() => 'returned'), new Promise((r) => setTimeout(() => r('stuck'), 200))])

    expect(outcome).toBe('returned')
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toMatch(/\/api\/telegram\/link-code$/)
    expect(init.method).toBe('POST')
    expect(sdk.execute).toHaveBeenCalledWith('openLinkInTab', { url })
  })
})
