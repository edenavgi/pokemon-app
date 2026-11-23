// The Telegram Bot API over plain fetch (Eden's choice: no wrapper library).
// https://core.telegram.org/bots/api — every method is POST https://api.telegram.org/bot<token>/<method>
import { setTimeout as delay } from 'node:timers/promises'
import { currentEvent } from '../log/wideEvent'

export const MESSAGE_MAX = 4096 // text of one message
export const CAPTION_MAX = 1024 // caption of a photo
/** A 429 asking to wait longer than this is not retried here (a webhook reply must be quick). */
export const MAX_RETRY_AFTER_SECONDS = 5

export interface TelegramPort {
  sendMessage(chatId: string, text: string): Promise<void>
  sendPhoto(chatId: string, png: Buffer, caption: string): Promise<void>
  setWebhook(url: string, secret: string): Promise<void>
  /** The command menu Telegram shows when the user types "/". */
  setMyCommands(commands: { command: string; description: string }[]): Promise<void>
}

/** Telegram answered ok:false. The message has the method and Telegram's description, never the token. */
export class TelegramError extends Error {
  readonly status: number
  constructor(method: string, status: number, description: string) {
    super(`Telegram ${method} failed (${status}): ${description}`)
    this.name = 'TelegramError'
    this.status = status
  }
}

export class RateLimitedError extends TelegramError {
  readonly retryAfter: number
  constructor(method: string, retryAfter: number) {
    super(method, 429, `rate limited, retry after ${retryAfter} s`)
    this.name = 'RateLimitedError'
    this.retryAfter = retryAfter
  }
}

interface TelegramReply { ok: boolean; description?: string; parameters?: { retry_after?: number } }

/** Splits at line breaks so each part fits; a single line longer than `max` is cut hard. */
export function splitText(text: string, max = MESSAGE_MAX): string[] {
  const parts: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    const candidate = current === '' ? line : `${current}\n${line}`
    if (candidate.length <= max) {
      current = candidate
      continue
    }
    if (current !== '') parts.push(current)
    let rest = line
    while (rest.length > max) {
      parts.push(rest.slice(0, max))
      rest = rest.slice(max)
    }
    current = rest
  }
  parts.push(current)
  return parts
}

export function createTelegramApi(
  token: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  opts: { sleep?: (ms: number) => Promise<unknown> } = {},
): TelegramPort {
  const sleep = opts.sleep ?? delay

  async function call(method: string, body: () => { body: string | FormData; json: boolean }): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      currentEvent()?.inc('telegramCalls')
      const b = body()
      let res: Response
      try {
        res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
          method: 'POST',
          headers: b.json ? { 'Content-Type': 'application/json' } : undefined,
          body: b.body,
        })
      } catch (err) {
        // fetch errors can carry the URL (and so the token): keep only a safe message
        throw new TelegramError(method, 0, err instanceof Error ? err.name : 'network error')
      }
      if (res.ok) return
      const reply = (await res.json().catch(() => ({}))) as TelegramReply
      if (res.status === 429) {
        const retryAfter = reply.parameters?.retry_after ?? MAX_RETRY_AFTER_SECONDS + 1
        if (attempt === 1 && retryAfter <= MAX_RETRY_AFTER_SECONDS) {
          currentEvent()?.set({ telegramRateLimited: retryAfter })
          await sleep(retryAfter * 1000)
          continue
        }
        throw new RateLimitedError(method, retryAfter)
      }
      throw new TelegramError(method, res.status, reply.description ?? `HTTP ${res.status}`)
    }
  }

  const json = (payload: unknown) => () => ({ body: JSON.stringify(payload), json: true })

  return {
    async sendMessage(chatId, text) {
      for (const part of splitText(text)) await call('sendMessage', json({ chat_id: chatId, text: part }))
    },
    async sendPhoto(chatId, png, caption) {
      await call('sendPhoto', () => {
        const form = new FormData()
        form.set('chat_id', chatId)
        form.set('caption', caption.slice(0, CAPTION_MAX))
        form.set('photo', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'battle.png')
        return { body: form, json: false }
      })
    },
    async setWebhook(url, secret) {
      await call('setWebhook', json({ url, secret_token: secret, allowed_updates: ['message'] }))
    },
    async setMyCommands(commands) {
      await call('setMyCommands', json({ commands }))
    },
  }
}
