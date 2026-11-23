// The bot's commands. Each handler gets the chat's user (resolveChat) and returns the reply text.
// Board data is read live from monday on every command: the board is the source of truth and
// people change it in monday at any time, so a cached copy would answer with stale gyms or levels.
import type { BoardGateway } from '@app/api/boards/gateway'
import type { BoardConfig, Id } from '@app/api/GameApi'
import { MAX_ENERGY } from '@app/game/constants'
import type { Deps } from '../deps'
import { matchGym } from './args'
import { texts } from './texts'

export interface CommandCtx {
  chatId: string
  userId: Id
  accountId: Id
  boards: BoardConfig
  gateway: BoardGateway
  pokeApi: ReturnType<Deps['pokeApiFor']>
  deps: Pick<Deps, 'repos' | 'now' | 'config'>
}
export type CommandHandler = (ctx: CommandCtx, args: string[]) => Promise<string>

/** The Telegram command menu (setMyCommands) and /help come from this list. */
export const BOT_COMMANDS: { command: string; description: string }[] = [
  { command: 'gyms', description: 'List your gyms' },
  { command: 'roster', description: 'Show a gym\'s Pokémon: /roster <gym>' },
  { command: 'help', description: 'What the bot can do' },
]

export const helpText = () =>
  ['Commands:', ...BOT_COMMANDS.map((c) => `/${c.command} — ${c.description}`)].join('\n')

const listGyms = (ctx: CommandCtx) => ctx.gateway.listGyms({ boardIds: [ctx.boards.gymsBoardId] })

export const COMMANDS: Record<string, CommandHandler> = {
  async gyms(ctx) {
    const gyms = await listGyms(ctx)
    if (gyms.length === 0) return texts.noGyms
    return gyms.map((g) => `${g.name} — ${g.type ?? 'no type'} — ${g.roster.length} Pokémon`).join('\n')
  },

  async roster(ctx, args) {
    if (args.length === 0) return texts.usage('/roster <gym>')
    const match = matchGym(args.join(' '), await listGyms(ctx))
    if (!match.ok) return match.reply
    const { gym } = match
    if (gym.roster.length === 0) return texts.emptyRoster(gym.name)
    return [
      `${gym.name}${gym.type ? ` (${gym.type})` : ''}`,
      ...gym.roster.map((p) => `${p.name} — Lv ${p.level} — ${p.status} — ⚡${p.energy}/${MAX_ENERGY}`),
    ].join('\n')
  },

  async help() {
    return helpText()
  },
}
