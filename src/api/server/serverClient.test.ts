import { describe, expect, it, vi } from 'vitest'
import { ServerError, createServerClient } from './serverClient'

function fakeFetch(...answers: (Response | Error)[]) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = answers.shift()
    if (!next) throw new Error('unexpected fetch')
    if (next instanceof Error) throw next
    return next
  })
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('createServerClient', () => {
  it('sends Authorization: Bearer <sessionToken> on every call, to baseUrl + path', async () => {
    const fetchImpl = fakeFetch(json(200, { a: 1 }), json(200, { b: 2 }), new Response(null, { status: 204 }))
    let n = 0
    const client = createServerClient('https://server.test', async () => `token-${++n}`, fetchImpl)

    expect(await client.get('/api/me')).toEqual({ a: 1 })
    expect(await client.post('/api/oauth/start')).toEqual({ b: 2 })
    await client.put('/api/me/boards', { gymsBoardId: 'g', pokemonBoardId: 'p' })

    const calls = fetchImpl.mock.calls
    expect(calls.map(([url]) => url)).toEqual([
      'https://server.test/api/me', 'https://server.test/api/oauth/start', 'https://server.test/api/me/boards',
    ])
    expect(calls.map(([, init]) => new Headers(init?.headers).get('authorization'))).toEqual([
      'Bearer token-1', 'Bearer token-2', 'Bearer token-3', // a fresh sessionToken each time: they expire
    ])
    expect(calls.map(([, init]) => init?.method)).toEqual(['GET', 'POST', 'PUT'])
    expect(new Headers(calls[2][1]?.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(String(calls[2][1]?.body))).toEqual({ gymsBoardId: 'g', pokemonBoardId: 'p' })
  })

  it('an empty baseUrl calls the same origin (the Vite dev proxy)', async () => {
    const fetchImpl = fakeFetch(json(200, {}))
    await createServerClient('', async () => 't', fetchImpl).get('/api/me')
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/me')
  })

  it('maps a 401 to ServerError{status:401} with the server code', async () => {
    const client = createServerClient('', async () => 't', fakeFetch(json(401, { error: 'UNAUTHORIZED' })))
    const err = await client.get('/api/me').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ServerError)
    expect(err).toMatchObject({ status: 401, code: 'UNAUTHORIZED' })
  })

  it('maps a non-JSON error and a network failure too', async () => {
    const client = createServerClient('', async () => 't', fakeFetch(new Response('<html>Bad gateway</html>', { status: 502 }), new TypeError('Failed to fetch')))
    await expect(client.get('/api/me')).rejects.toMatchObject({ status: 502, code: 'HTTP_502' })
    await expect(client.get('/api/me')).rejects.toMatchObject({ status: 0, code: 'NETWORK' })
  })
})
