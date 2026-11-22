import { describe, expect, it, vi } from 'vitest'
import { RateLimitedError, mondayRequest, type ApiClientLike } from './client'

// The shape graphql-request's ClientError has when monday answers 429 (docs: rate limits)
const rateLimited = (seconds: number, code = 'COMPLEXITY_BUDGET_EXHAUSTED') =>
  Object.assign(new Error('Complexity budget exhausted'), {
    response: { status: 429, errors: [{ message: 'Complexity budget exhausted', extensions: { code, retry_in_seconds: seconds } }] },
  })

function setup(...answers: (unknown | Error)[]) {
  const calls: { token: string; apiVersion?: string }[] = []
  const request = vi.fn(async () => {
    const next = answers.shift()
    if (next instanceof Error) throw next
    return next
  })
  const createClient = (cfg: { token: string; apiVersion?: string }): ApiClientLike => {
    calls.push(cfg)
    return { request } as ApiClientLike
  }
  const sleep = vi.fn(async (_ms: number) => {})
  return { calls, request, createClient, sleep }
}

describe('mondayRequest', () => {
  it('uses the token and API version 2026-10, and returns the GraphQL data', async () => {
    const { calls, createClient, sleep } = setup({ me: { id: 1 } })
    const gql = mondayRequest(async () => 'user-token', { createClient, sleep })
    expect(await gql('query { me { id } }')).toEqual({ me: { id: 1 } })
    expect(calls[0]).toEqual({ token: 'user-token', apiVersion: '2026-10' })
  })

  it('retries once after retry_in_seconds on 429', async () => {
    const { request, createClient, sleep } = setup(rateLimited(3), { ok: true })
    const gql = mondayRequest(async () => 't', { createClient, sleep })
    expect(await gql('query { x }')).toEqual({ ok: true })
    expect(sleep).toHaveBeenCalledWith(3000)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('waits at most 10 s, otherwise gives up at once', async () => {
    const { request, createClient, sleep } = setup(rateLimited(45))
    const gql = mondayRequest(async () => 't', { createClient, sleep })
    await expect(gql('query { x }')).rejects.toBeInstanceOf(RateLimitedError)
    expect(sleep).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('throws RateLimitedError on a second 429', async () => {
    const { createClient, sleep } = setup(rateLimited(1), rateLimited(1, 'RATE_LIMIT_EXCEEDED'))
    const gql = mondayRequest(async () => 't', { createClient, sleep })
    const err = await gql('query { x }').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RateLimitedError)
    expect((err as RateLimitedError).retryInSeconds).toBe(1)
  })

  it('passes other errors through untouched', async () => {
    const boom = new Error('Graphql validation errors')
    const { createClient, sleep } = setup(boom)
    await expect(mondayRequest(async () => 't', { createClient, sleep })('query { x }')).rejects.toBe(boom)
  })
})
