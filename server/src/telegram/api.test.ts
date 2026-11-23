import { describe, expect, it, vi } from 'vitest'
import { fakeLogger } from '../../test/fakes'
import { withEvent } from '../log/wideEvent'
import { CAPTION_MAX, createTelegramApi, MESSAGE_MAX, RateLimitedError, TelegramError } from './api'

const TOKEN = '123456:SECRET-bot-token'
type Call = { url: string; init: RequestInit }

/** A fake fetch that answers each call from `answers` in order (the last one repeats). */
function fakeFetch(...answers: { status?: number; body: unknown }[]) {
  const calls: Call[] = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const a = answers[Math.min(calls.length - 1, answers.length - 1)]
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}
const OK = { body: { ok: true, result: {} } }
const json = (c: Call) => JSON.parse(String(c.init.body))

describe('createTelegramApi', () => {
  it('sendMessage POSTs chat_id and text to the bot API', async () => {
    const { fetchImpl, calls } = fakeFetch(OK)
    await createTelegramApi(TOKEN, fetchImpl).sendMessage('42', 'hi')
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
    expect(calls[0].init.method).toBe('POST')
    expect(json(calls[0])).toEqual({ chat_id: '42', text: 'hi' })
  })

  it(`sendMessage splits text longer than ${MESSAGE_MAX} chars into several messages, in order`, async () => {
    const { fetchImpl, calls } = fakeFetch(OK)
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i} `.padEnd(30, '.'))
    const text = lines.join('\n') // 9 299 chars: 132 + 132 + 36 lines
    await createTelegramApi(TOKEN, fetchImpl).sendMessage('42', text)
    const parts = calls.map((c) => json(c).text as string)
    expect(parts.length).toBe(3)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(MESSAGE_MAX)
    expect(parts.join('\n')).toBe(text) // split at line breaks, nothing lost
  })

  it(`sendPhoto sends the PNG as multipart and cuts the caption to ${CAPTION_MAX} chars`, async () => {
    const { fetchImpl, calls } = fakeFetch(OK)
    await createTelegramApi(TOKEN, fetchImpl).sendPhoto('42', Buffer.from([0x89, 0x50]), 'x'.repeat(2000))
    expect(calls[0].url).toMatch(/\/sendPhoto$/)
    const form = calls[0].init.body as FormData
    expect(form.get('chat_id')).toBe('42')
    expect(String(form.get('caption')).length).toBe(CAPTION_MAX)
    expect(form.get('photo')).toBeInstanceOf(Blob)
  })

  it('setWebhook sends the URL, the secret token and only message updates', async () => {
    const { fetchImpl, calls } = fakeFetch(OK)
    await createTelegramApi(TOKEN, fetchImpl).setWebhook('https://server.test/telegram/webhook', 's3cret')
    expect(calls[0].url).toMatch(/\/setWebhook$/)
    expect(json(calls[0])).toEqual({ url: 'https://server.test/telegram/webhook', secret_token: 's3cret', allowed_updates: ['message'] })
  })

  it('setMyCommands sends the command menu', async () => {
    const { fetchImpl, calls } = fakeFetch(OK)
    const commands = [{ command: 'gyms', description: 'List your gyms' }]
    await createTelegramApi(TOKEN, fetchImpl).setMyCommands(commands)
    expect(calls[0].url).toMatch(/\/setMyCommands$/)
    expect(json(calls[0])).toEqual({ commands })
  })

  it('sendMessage retries once on 429 with retry_after 1', async () => {
    const { fetchImpl, calls } = fakeFetch({ status: 429, body: { ok: false, parameters: { retry_after: 1 } } }, OK)
    const sleep = vi.fn(async () => {})
    await createTelegramApi(TOKEN, fetchImpl, { sleep }).sendMessage('42', 'hi')
    expect(calls).toHaveLength(2)
    expect(sleep).toHaveBeenCalledWith(1000)
  })

  it('a 429 with a long retry_after throws RateLimitedError without waiting', async () => {
    const { fetchImpl, calls } = fakeFetch({ status: 429, body: { ok: false, parameters: { retry_after: 30 } } })
    const sleep = vi.fn(async () => {})
    await expect(createTelegramApi(TOKEN, fetchImpl, { sleep }).sendMessage('42', 'hi')).rejects.toBeInstanceOf(RateLimitedError)
    expect(calls).toHaveLength(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('another error throws TelegramError with the description and never the bot token', async () => {
    const { fetchImpl } = fakeFetch({ status: 400, body: { ok: false, description: 'Bad Request: chat not found' } })
    const err = await createTelegramApi(TOKEN, fetchImpl).sendMessage('42', 'hi').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TelegramError)
    expect(String((err as Error).message)).toContain('chat not found')
    expect(JSON.stringify(err) + String((err as Error).message) + String((err as Error).stack)).not.toContain(TOKEN)
  })

  it('counts telegramCalls on the current wide event, and the token never reaches the log', async () => {
    const { fetchImpl } = fakeFetch({ status: 429, body: { ok: false, parameters: { retry_after: 1 } } }, OK)
    const log = fakeLogger()
    await withEvent(log.logger, 'http', {}, () =>
      createTelegramApi(TOKEN, fetchImpl, { sleep: async () => {} }).sendMessage('42', 'hi'))
    expect(log.events()[0]).toMatchObject({ telegramCalls: 2 })
    expect(log.info.join('\n')).not.toContain(TOKEN)
  })
})
