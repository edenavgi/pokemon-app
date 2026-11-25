// Telegram → us. The bot (@eden_gym_bot) has a webhook: Telegram POSTs every message to
// /telegram/webhook with our secret in the X-Telegram-Bot-Api-Secret-Token header.
// Linking: the app asks for a one-time code (POST /api/telegram/link-code) and opens
// https://t.me/<bot>?start=<code>; pressing Start sends "/start <code>", which links that chat.
import { timingSafeEqual } from 'node:crypto'
import express, { type RequestHandler } from 'express'
import { createBoardGateway, type BoardGateway } from '@app/api/boards/gateway'
import type { BoardConfig, Id } from '@app/api/GameApi'
import type { Session } from '../auth/sessionToken'
import { ReconnectNeededError } from '../auth/tokenStore'
import type { Deps } from '../deps'
import type { WideEvent } from '../log/wideEvent'
import { parseCommand } from './args'
import { COMMANDS } from './commands'
import { hashCode, LINK_CODE_TTL_MS, newLinkCode } from './linking'
import { texts } from './texts'

export type TelegramDeps = Pick<Deps, 'config' | 'repos' | 'tokens' | 'now' | 'mondayFor' | 'pokeApiFor' | 'queue' | 'telegram' | 'renderCard' | 'objectStorage' | 'mondayFileFor'>

/** The part of a Telegram Update we read. https://core.telegram.org/bots/api#update */
interface TgUpdate {
  update_id?: unknown
  message?: { chat?: { id?: unknown }; text?: unknown }
}

/** POST /api/telegram/link-code (behind requireSession) → { url: https://t.me/<bot>?start=<code> } */
export function linkCodeRoute(deps: TelegramDeps): RequestHandler {
  return async (_req, res) => {
    const { userId, accountId } = res.locals.session as Session
    // The bot will act with the user's monday token, so they must have connected monday first
    if (!(await deps.tokens.has(userId))) {
      res.status(409).json({ error: 'NOT_CONNECTED' })
      return
    }
    const code = newLinkCode()
    await deps.repos.linkCodes.create({
      _id: hashCode(code), userId, accountId, expiresAt: new Date(deps.now().getTime() + LINK_CODE_TTL_MS),
    })
    res.json({ url: `https://t.me/${deps.config.telegramBotUsername}?start=${code}` })
  }
}

/** Constant-time compare, so the secret can't be guessed from response times. */
function sameSecret(given: string | undefined, expected: string): boolean {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * POST /telegram/webhook. Always answers 200 once the secret is right: anything else makes
 * Telegram retry the same update again and again. Failures are logged on the request's event.
 */
export function telegramWebhook(deps: TelegramDeps): RequestHandler[] {
  return [
    express.json(),
    async (req, res) => {
      if (!sameSecret(req.get('X-Telegram-Bot-Api-Secret-Token'), deps.config.telegramWebhookSecret)) {
        res.status(401).json({ error: 'UNAUTHORIZED' })
        return
      }
      const ev = res.locals.wideEvent as WideEvent
      const update = (req.body ?? {}) as TgUpdate
      try {
        if (typeof update.update_id === 'number') {
          ev.set({ updateId: update.update_id })
          if (!(await deps.repos.tgUpdates.markNew(update.update_id))) {
            ev.set({ duplicate: true })
          } else {
            await handleUpdate(deps, ev, update)
          }
        }
      } catch (err) {
        ev.error(err)
      }
      res.status(200).json({ ok: true })
    },
  ]
}

async function handleUpdate(deps: TelegramDeps, ev: WideEvent, update: TgUpdate): Promise<void> {
  const chatId = update.message?.chat?.id
  const text = update.message?.text
  if ((typeof chatId !== 'number' && typeof chatId !== 'string') || typeof text !== 'string') {
    ev.set({ ignored: 'NOT_A_TEXT_MESSAGE' })
    return
  }
  const chat = String(chatId)
  const cmd = parseCommand(text, deps.config.telegramBotUsername)
  // Only the command name is logged: its args may be a link code
  ev.set({ chatId: chat, command: cmd ? `/${cmd.name}` : 'text' })

  if (cmd?.name === 'start' && cmd.args[0]) {
    await handleStart(deps, chat, cmd.args[0])
    return
  }
  await deps.telegram.sendMessage(chat, await runCommand(deps, ev, chat, cmd))
}

/** Runs a command for a linked chat and returns the reply. Plain text and unknown commands get the help. */
async function runCommand(
  deps: TelegramDeps, ev: WideEvent, chatId: string, cmd: { name: string; args: string[] } | null,
): Promise<string> {
  const resolved = await resolveChat(deps, chatId)
  if (!resolved.ok) return resolved.reply
  ev.set({ userId: resolved.userId, accountId: resolved.accountId })
  const handler = (cmd && Object.hasOwn(COMMANDS, cmd.name) ? COMMANDS[cmd.name] : undefined) ?? COMMANDS.help
  try {
    return await handler({
      chatId, userId: resolved.userId, accountId: resolved.accountId, boards: resolved.boards,
      gateway: resolved.gateway, pokeApi: deps.pokeApiFor(resolved.userId), deps,
    }, cmd?.args ?? [])
  } catch (err) {
    ev.error(err) // the event shows what failed; the user gets a short, friendly reply
    return err instanceof ReconnectNeededError ? texts.reconnect : texts.oops
  }
}

/** /start <code>: the code (single use, 10 min) says which monday user this chat belongs to. */
export async function handleStart(deps: TelegramDeps, chatId: string, code: string): Promise<void> {
  const pending = await deps.repos.linkCodes.consume(hashCode(code))
  if (!pending) {
    await deps.telegram.sendMessage(chatId, texts.badCode)
    return
  }
  await deps.repos.links.replaceForUser({ chatId, userId: pending.userId, accountId: pending.accountId })
  try {
    const me = await createBoardGateway(deps.mondayFor(pending.userId)).me()
    await deps.telegram.sendMessage(chatId, texts.linked(me.name, me.accountName, me.userId, me.accountId))
  } catch (err) {
    if (!(err instanceof ReconnectNeededError)) throw err
    await deps.telegram.sendMessage(chatId, texts.reconnect)
  }
}

export type ResolvedChat =
  | { ok: true; userId: Id; accountId: Id; boards: BoardConfig; gateway: BoardGateway }
  | { ok: false; reply: string }

/** Who this chat plays as, with a board gateway that acts with that user's monday token. */
export async function resolveChat(deps: Pick<TelegramDeps, 'repos' | 'tokens' | 'mondayFor'>, chatId: string): Promise<ResolvedChat> {
  const link = await deps.repos.links.get(chatId)
  if (!link) return { ok: false, reply: texts.notLinked }
  const user = await deps.repos.users.get(link.userId)
  if (!user?.gymsBoardId || !user.pokemonBoardId) return { ok: false, reply: texts.noBoards }
  if (!(await deps.tokens.has(link.userId))) return { ok: false, reply: texts.reconnect }
  return {
    ok: true,
    userId: link.userId,
    accountId: link.accountId,
    boards: { gymsBoardId: user.gymsBoardId, pokemonBoardId: user.pokemonBoardId },
    gateway: createBoardGateway(deps.mondayFor(link.userId)),
  }
}
