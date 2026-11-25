// The bot's commands. Each handler gets the chat's user (resolveChat) and returns the reply text.
// Board data is read live from monday on every command: the board is the source of truth and
// people change it in monday at any time, so a cached copy would answer with stale gyms or levels.
import { randomUUID } from 'node:crypto'
import type { BoardGateway } from '@app/api/boards/gateway'
import type { BoardConfig, Id, Pokemon } from '@app/api/GameApi'
import { MAX_ENERGY } from '@app/game/constants'
import { evolutionCheck } from '@app/game/evolution'
import { allowedTransitions, applyRest, applySpar, validateSpar } from '@app/game/status'
import { buildTalkPrompt } from '@app/game/talk'
import { battleErrorText, sparErrorText, talkFallbackText } from '@app/lib/messages'
import { startBattle, type BattleDeps } from '../battle/service'
import type { Deps } from '../deps'
import { currentEvent } from '../log/wideEvent'
import { matchGym, matchPokemon, splitTwoGyms } from './args'
import { texts } from './texts'

export interface CommandCtx {
  chatId: string
  userId: Id
  accountId: Id
  boards: BoardConfig
  gateway: BoardGateway
  pokeApi: ReturnType<Deps['pokeApiFor']>
  deps: Pick<Deps, 'repos' | 'now' | 'config'> & BattleDeps
}
export type CommandHandler = (ctx: CommandCtx, args: string[]) => Promise<string>

/** The Telegram command menu (setMyCommands) and /help come from this list. */
export const BOT_COMMANDS: { command: string; description: string }[] = [
  { command: 'gyms', description: 'List your gyms' },
  { command: 'roster', description: 'Show a gym\'s Pokémon: /roster <gym>' },
  { command: 'train', description: 'Spar two Pokémon of one gym: /train <pokemon> <partner>' },
  { command: 'rest', description: 'Refill a Resting Pokémon\'s energy: /rest <pokemon>' },
  { command: 'talk', description: 'Say hi to a Pokémon: /talk <pokemon>' },
  { command: 'battle', description: 'Two gyms fight in the Arena: /battle <gym> <gym>' },
  { command: 'help', description: 'What the bot can do' },
]

export const helpText = () =>
  ['Commands:', ...BOT_COMMANDS.map((c) => `/${c.command} — ${c.description}`)].join('\n')

const listGyms = (ctx: CommandCtx) => ctx.gateway.listGyms({ boardIds: [ctx.boards.gymsBoardId] })
const listPokemon = (ctx: CommandCtx) => ctx.gateway.listPokemon({ boardIds: [ctx.boards.pokemonBoardId] })

/**
 * Names → items, then the same items read AGAIN right before the rules run: the name lookup may be
 * a moment old, and someone may have changed the board since. The rules decide on these fresh values.
 */
async function findFresh(ctx: CommandCtx, names: string[]): Promise<{ ok: true; ps: Pokemon[] } | { ok: false; reply: string }> {
  const all = await listPokemon(ctx)
  const ids: Id[] = []
  for (const name of names) {
    const m = matchPokemon(name, all)
    if (!m.ok) return m
    ids.push(m.p.id)
  }
  const byId = new Map((await ctx.gateway.getPokemonMany(ids)).map((p) => [p.id, p]))
  return { ok: true, ps: ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])) }
}

/** "X can evolve into Y" when the new level allows it. PokéAPI trouble only drops the hint. */
async function evolveHint(ctx: CommandCtx, p: Pokemon): Promise<string | undefined> {
  try {
    const check = evolutionCheck(p, await ctx.pokeApi.getEvolution(p.dexNumber))
    return check.eligible ? texts.canEvolve(p.name, check.target.name) : undefined
  } catch (err) {
    currentEvent()?.set({ evolutionLookupFailed: err instanceof Error ? err.message : String(err) })
    return undefined
  }
}

/** The GraphQL error code (graphql-request's ClientError), else the message. For the event only. */
function errorCode(err: unknown): string {
  const code = (err as { response?: { errors?: { extensions?: { code?: unknown } }[] } })?.response?.errors?.[0]?.extensions?.code
  if (code != null) return String(code)
  return err instanceof Error ? err.message : String(err)
}

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

  // v1 Spar: both +1 level, −1 energy, status from the rules; written to the board in ONE request
  async train(ctx, args) {
    if (args.length !== 2) return texts.usage('/train <pokemon> <partner>')
    const found = await findFresh(ctx, args)
    if (!found.ok) return found.reply
    const valid = validateSpar(found.ps)
    if (!valid.ok) return sparErrorText(valid.error, valid.names)
    const patches = found.ps.map((p) => ({ id: p.id, patch: applySpar(p) }))
    await ctx.gateway.updatePokemon(patches)
    const after = found.ps.map((p, i) => ({ ...p, ...patches[i].patch }))
    const hints = await Promise.all(after.map((p) => evolveHint(ctx, p)))
    return [...after.map(texts.trained), ...hints.filter((h) => h !== undefined)].join('\n')
  },

  // v1 Rest: only a Resting Pokémon; energy back to full, status by level
  async rest(ctx, args) {
    if (args.length === 0) return texts.usage('/rest <pokemon>')
    const found = await findFresh(ctx, [args.join(' ')])
    if (!found.ok) return found.reply
    const [p] = found.ps
    if (!p) return texts.unknownPokemon(args.join(' '))
    if (!allowedTransitions(p).canRest) return texts.cantRest(p.name, p.status)
    const patch = applyRest(p)
    await ctx.gateway.updatePokemon([{ id: p.id, patch }])
    return texts.rested({ ...p, ...patch })
  },

  /**
   * The v1 Talk button, from Telegram: the same prompt (buildTalkPrompt) and the same run_prompt
   * settings (the shared gateway), but with the user's OAuth token instead of the iframe's
   * seamless auth. Any failure before the reply → the Pokémon is "napping", and the cause goes on the event.
   */
  async talk(ctx, args) {
    if (args.length === 0) return texts.usage('/talk <pokemon>')
    const match = matchPokemon(args.join(' '), await listPokemon(ctx))
    if (!match.ok) return match.reply
    const { p } = match
    try {
      const species = await ctx.pokeApi.getSpecies(p.dexNumber)
      const reply = await ctx.gateway.runPrompt(buildTalkPrompt(species))
      return `${p.name}: ${reply.trim()}`
    } catch (err) {
      currentEvent()?.set({ talkFailed: errorCode(err) })
      return talkFallbackText(p.name)
    }
  },

  /**
   * The Arena, from Telegram: only finds the two gyms and hands them to the SAME startBattle the app
   * uses. The queue runs the battle (no battle logic here), and the result comes back to this chat.
   * The battle keeps this webhook's traceId, so the queue's event continues it.
   */
  async battle(ctx, args) {
    const split = splitTwoGyms(args, await listGyms(ctx))
    if (!split.ok) return split.reply
    const result = await startBattle(ctx.deps, {
      userId: ctx.userId, accountId: ctx.accountId, source: 'telegram', chatId: ctx.chatId,
      gymAId: split.a.id, gymBId: split.b.id, traceId: currentEvent()?.traceId ?? randomUUID(),
    })
    if ('error' in result) {
      currentEvent()?.set({ battleError: result.error })
      switch (result.error) {
        case 'NOT_CONNECTED': return texts.reconnect
        case 'NO_BOARDS': return texts.noBoards
        case 'UNKNOWN_GYM': return texts.noSplit // a gym vanished between the two reads
        default: return battleErrorText(result.error)
      }
    }
    return texts.battleStarted(split.a.name, split.b.name)
  },

  async help() {
    return helpText()
  },
}
