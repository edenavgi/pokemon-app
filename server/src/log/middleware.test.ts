import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { fakeLogger } from '../../test/fakes'
import { errorHandler, wideEventMiddleware } from './middleware'
import { currentEvent } from './wideEvent'

function appWith(route: (app: express.Express) => void) {
  const log = fakeLogger()
  const app = express()
  app.use(wideEventMiddleware(log.logger))
  route(app)
  app.use(errorHandler)
  return { app, ...log }
}

describe('wideEventMiddleware', () => {
  it('logs the route pattern, not the concrete URL', async () => {
    const { app, events } = appWith((a) => a.get('/battles/:id', (_req, res) => void res.json({})))
    await request(app).get('/battles/abc123')
    expect(events()[0].path).toBe('/battles/:id')
  })

  it('lets a handler add fields after an await', async () => {
    const { app, events } = appWith((a) =>
      a.get('/x', async (_req, res) => {
        await new Promise((r) => setTimeout(r, 1))
        currentEvent()?.set({ gymCount: 2 })
        res.json({})
      }),
    )
    await request(app).get('/x')
    expect(events()[0].gymCount).toBe(2)
  })
})

describe('errorHandler', () => {
  it('turns a thrown error into a JSON 500 without the stack, logged once as an error', async () => {
    const { app, errors, info } = appWith((a) =>
      a.get('/boom', async () => {
        throw new Error('kaboom')
      }),
    )
    const res = await request(app).get('/boom')

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'INTERNAL' })
    expect(res.text).not.toContain('kaboom')
    expect(info).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(JSON.parse(errors[0].msg)).toMatchObject({ status: 500, error: { message: 'kaboom' } })
  })
})
