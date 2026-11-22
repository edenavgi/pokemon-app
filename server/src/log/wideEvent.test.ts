import { describe, expect, it } from 'vitest'
import { fakeLogger } from '../../test/fakes'
import { WideEvent, currentEvent, redact, withEvent } from './wideEvent'

describe('WideEvent', () => {
  it('emits exactly one JSON line per unit of work', () => {
    const { logger, info } = fakeLogger()
    const ev = new WideEvent('http', { path: '/x' })
    ev.set({ a: 1 })
    ev.set({ b: 2 })
    ev.emit(logger)

    expect(info).toHaveLength(1)
    const line = JSON.parse(info[0])
    expect(line).toMatchObject({ kind: 'http', path: '/x', a: 1, b: 2 })
    expect(typeof line.traceId).toBe('string')
    expect(line.traceId.length).toBeGreaterThan(0)
    expect(typeof line.durationMs).toBe('number')
  })

  it('keeps a given traceId', () => {
    const { logger, events } = fakeLogger()
    new WideEvent('queue', {}, 'trace-123').emit(logger)
    expect(events()[0].traceId).toBe('trace-123')
  })

  it('inc() counts', () => {
    const { logger, events } = fakeLogger()
    const ev = new WideEvent('http')
    ev.inc('mondayCalls')
    ev.inc('mondayCalls', 2)
    ev.emit(logger)
    expect(events()[0].mondayCalls).toBe(3)
  })

  it('error() records name and message and emits through logger.error', () => {
    const { logger, info, errors } = fakeLogger()
    const ev = new WideEvent('http')
    ev.error(new TypeError('boom'))
    ev.emit(logger)

    expect(info).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(JSON.parse(errors[0].msg).error).toEqual({ name: 'TypeError', message: 'boom' })
    expect(errors[0].error).toBeInstanceOf(TypeError)
  })

  it('never emits a secret it was given', () => {
    const { logger, info } = fakeLogger()
    const ev = new WideEvent('http')
    ev.set({ oauth: { accessToken: 'SECRET-A' } })
    ev.emit(logger)
    expect(info[0]).not.toContain('SECRET-A')
  })
})

describe('redact', () => {
  it('redacts secrets at any depth', () => {
    const out = JSON.stringify(
      redact({ a: { accessToken: 'x1', refresh_token: 'y1' }, headers: { authorization: 'Bearer z1' }, list: [{ clientSecret: 'w1' }] }),
    )
    for (const secret of ['x1', 'y1', 'z1', 'w1']) expect(out).not.toContain(secret)
    expect(out).toContain('[redacted]')
  })

  it('redacts an OAuth "code" but keeps statusCode and traceId', () => {
    expect(redact({ code: 'abc', statusCode: 200, traceId: 't1' })).toEqual({ code: '[redacted]', statusCode: 200, traceId: 't1' })
  })
})

describe('withEvent / currentEvent', () => {
  it('currentEvent() is visible inside awaited calls and undefined outside', async () => {
    const { logger } = fakeLogger()
    expect(currentEvent()).toBeUndefined()
    await withEvent(logger, 'http', {}, async (ev) => {
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 1))
      expect(currentEvent()).toBe(ev)
    })
    expect(currentEvent()).toBeUndefined()
  })

  it('emits once and returns the result', async () => {
    const { logger, events } = fakeLogger()
    const result = await withEvent(logger, 'cron', { job: 'x' }, async (ev) => {
      ev.set({ changed: 2 })
      return 'done'
    })
    expect(result).toBe('done')
    expect(events()).toHaveLength(1)
    expect(events()[0]).toMatchObject({ kind: 'cron', job: 'x', changed: 2 })
  })

  it('records a thrown error, emits once and rethrows', async () => {
    const { logger, errors, info } = fakeLogger()
    await expect(
      withEvent(logger, 'queue', {}, async () => {
        throw new Error('nope')
      }),
    ).rejects.toThrow('nope')
    expect(info).toHaveLength(0)
    expect(errors).toHaveLength(1)
  })
})
