import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { fakeLogger, testConfig } from '../test/fakes'
import { createApp } from './app'

function setup() {
  const log = fakeLogger()
  const app = createApp({ config: testConfig(), logger: log.logger, now: () => new Date() })
  return { app, ...log }
}

describe('GET /health', () => {
  it('returns ok with the server version', async () => {
    const { app } = setup()
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, version: expect.any(String) })
  })
})

describe('wide events for HTTP', () => {
  it('every request emits one http event with method, path, status, durationMs', async () => {
    const { app, events } = setup()
    await request(app).get('/health?probe=1')

    expect(events()).toHaveLength(1)
    expect(events()[0]).toMatchObject({ kind: 'http', method: 'GET', path: '/health', status: 200 })
    expect(typeof events()[0].durationMs).toBe('number')
    expect(typeof events()[0].traceId).toBe('string')
  })

  it('an unknown route is a 404 and still emits one event', async () => {
    const { app, events } = setup()
    const res = await request(app).get('/nope')
    expect(res.status).toBe(404)
    expect(events()).toHaveLength(1)
    expect(events()[0]).toMatchObject({ kind: 'http', status: 404 })
  })

  it('two requests get two different traceIds', async () => {
    const { app, events } = setup()
    await request(app).get('/health')
    await request(app).get('/health')
    const [a, b] = events()
    expect(a.traceId).not.toBe(b.traceId)
  })
})
