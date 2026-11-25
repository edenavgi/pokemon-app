// The hourly Energy regen (Phase 2, Task 14). monday code's scheduler POSTs /mndy-cronjob/energy-regen
// at minute 0 of every hour (UTC), on the LIVE app version only. Nobody is signed in, so each user's
// stored OAuth token is used.
//
// Safe to repeat: before touching a board, its hour mark (<pokemonBoardId>:<YYYY-MM-DDTHH>) is claimed.
// A scheduler retry, a second user on the same board or a manual call finds the mark and skips it, so a
// board never gets more than +1 per hour. A failed write gives the mark back, so a retry can apply it.
import type { RequestHandler } from 'express'
import { createBoardGateway } from '@app/api/boards/gateway'
import type { Id } from '@app/api/GameApi'
import { applyRegen } from '@app/game/status'
import { ReconnectNeededError } from '../auth/tokenStore'
import type { Deps } from '../deps'
import { currentEvent, withEvent } from '../log/wideEvent'

export { REGEN_MARK_KEEP_MS } from '../db/repos'

export interface RegenResult {
  /** Connected users with boards that were looked at */
  users: number
  /** Boards that got their +1 this run */
  boards: number
  /** Pokémon changed */
  changed: number
  /** Boards already done this hour */
  skipped: number
  failures: { userId: Id; reason: string }[]
}

/** "2026-11-24T14": one key per UTC hour. */
export const hourKeyOf = (d: Date) => d.toISOString().slice(0, 13)

export async function runEnergyRegen(deps: Pick<Deps, 'repos' | 'now' | 'mondayFor'>): Promise<RegenResult> {
  const hourKey = hourKeyOf(deps.now())
  const result: RegenResult = { users: 0, boards: 0, changed: 0, skipped: 0, failures: [] }
  // One user at a time: a slow or broken account only delays the rest, and monday's rate limits stay calm
  for await (const user of deps.repos.users.withBoards()) {
    result.users++
    const boardId = user.pokemonBoardId!
    let claimed = false
    try {
      claimed = await deps.repos.regenMarks.claim(boardId, hourKey)
      if (!claimed) {
        result.skipped++
        continue
      }
      const gateway = createBoardGateway(deps.mondayFor(user._id))
      const pokemon = await gateway.listPokemon({ boardIds: [boardId] })
      const patches = pokemon.flatMap((p) => {
        const patch = applyRegen(p)
        return patch ? [{ id: p.id, patch }] : []
      })
      if (patches.length > 0) await gateway.updatePokemon(patches) // one request for the whole board
      result.boards++
      result.changed += patches.length
    } catch (err) {
      if (claimed) await deps.repos.regenMarks.release(boardId, hourKey).catch(() => {}) // the next retry may apply it
      const reason = err instanceof ReconnectNeededError ? 'RECONNECT' : err instanceof Error ? err.name : 'Error'
      result.failures.push({ userId: user._id, reason })
    }
  }
  return result
}

/**
 * The scheduler's route. The run gets its own 'cron' wide event; the request's http event gets the
 * header names (not values) so we can see what the scheduler sends. Always 200: failures are per user,
 * and a non-2xx would only make the scheduler retry what the hour marks already protect.
 */
export function energyRegenRoute(deps: Deps): RequestHandler {
  return async (req, res) => {
    currentEvent()?.set({ cronJob: 'energy-regen', headerNames: Object.keys(req.headers).sort() })
    const hourKey = hourKeyOf(deps.now())
    try {
      await withEvent(deps.logger, 'cron', { job: 'energy-regen', hourKey }, async (ev) => {
        ev.set({ ...(await runEnergyRegen(deps)) })
      })
    } catch {
      // already recorded on the cron event (withEvent logs the error)
    }
    res.status(200).json({ ok: true })
  }
}
