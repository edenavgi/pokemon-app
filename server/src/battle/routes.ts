import express, { Router, type RequestHandler } from 'express'
import { battleErrorText } from '@app/lib/messages'
import type { Session } from '../auth/sessionToken'
import type { Deps } from '../deps'
import { cardFileName } from '../card/objectStorage'
import { withEvent, type WideEvent } from '../log/wideEvent'
import {
  parseQueueBody, runBattleMessage, startBattle, toBattleView,
  type BattleDeps, type BattleMessage, type StartError,
} from './service'

const START_STATUS: Record<StartError, number> = {
  SAME_GYM: 400, A_NOT_ELIGIBLE: 400, B_NOT_ELIGIBLE: 400, UNKNOWN_GYM: 400, NOT_CONNECTED: 409, NO_BOARDS: 409,
}
const MAX_LIST = 50

/** /api/battles — behind requireSession (the app). */
export function battleRoutes(deps: BattleDeps): Router {
  const router = Router()

  // Start: answers at once with the id; the battle runs from the queue.
  router.post('/', express.json(), async (req, res) => {
    const session = res.locals.session as Session
    const ev = res.locals.wideEvent as WideEvent
    const { gymAId, gymBId } = (req.body ?? {}) as Record<string, unknown>
    if (typeof gymAId !== 'string' || typeof gymBId !== 'string') {
      res.status(400).json({ error: 'BAD_REQUEST' })
      return
    }
    const result = await startBattle(deps, { ...session, source: 'app', gymAId, gymBId, traceId: ev.traceId })
    if ('error' in result) {
      ev.set({ battleError: result.error })
      const e = result.error
      const v1 = e === 'SAME_GYM' || e === 'A_NOT_ELIGIBLE' || e === 'B_NOT_ELIGIBLE'
      res.status(START_STATUS[e]).json(v1 ? { error: e, message: battleErrorText(e) } : { error: e })
      return
    }
    res.status(202).json(result)
  })

  // Recent battles of the user's Gyms board (the Arena's list, including Telegram battles)
  router.get('/', async (req, res) => {
    const { userId } = res.locals.session as Session
    const user = await deps.repos.users.get(userId)
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), MAX_LIST)
    const docs = user?.gymsBoardId ? await deps.repos.battles.recentForBoard(user.gymsBoardId, limit) : []
    res.json({ battles: docs.map(toBattleView) })
  })

  // The battle card PNG (Task 16), read back from Object storage. Same account only, like the battle.
  router.get('/:id/card', async (req, res) => {
    const { accountId } = res.locals.session as Session
    const doc = await deps.repos.battles.get(req.params.id)
    const file = doc && doc.accountId === accountId && doc.cardAt ? await deps.objectStorage.download(cardFileName(doc._id)) : null
    if (!file) {
      res.status(404).json({ error: 'NOT_FOUND' })
      return
    }
    res.type('image/png').set('Cache-Control', 'private, max-age=86400').send(file.content)
  })

  // One battle; ?turns=1 adds the turns (the replay). Other accounts get 404, not 403: don't confirm it exists.
  router.get('/:id', async (req, res) => {
    const { accountId } = res.locals.session as Session
    const doc = await deps.repos.battles.get(req.params.id)
    if (!doc || doc.accountId !== accountId) {
      res.status(404).json({ error: 'NOT_FOUND' })
      return
    }
    const withTurns = req.query.turns === '1'
    res.json({ battle: toBattleView(doc), ...(withTurns ? { turns: await deps.repos.battleTurns.list(doc._id) } : {}) })
  })

  return router
}

/**
 * POST /mndy-queue?secret=… — monday code delivers our queue messages here.
 * 200 = done with it (also for poison messages: retrying them can't help).
 * 503 = still running elsewhere, try later. 500 = failed, try again (the queue retries up to 10 times).
 */
export function queueRoute(deps: BattleDeps & Pick<Deps, 'logger'>): RequestHandler[] {
  return [
    express.text({ type: '*/*', limit: '1mb' }),
    async (req, res) => {
      let valid = false
      try {
        valid = deps.queue.validateMessageSecret(typeof req.query.secret === 'string' ? req.query.secret : '')
      } catch {
        valid = false // the SDK throws on an empty secret
      }
      if (!valid) {
        res.status(401).json({ error: 'UNAUTHORIZED' })
        return
      }

      let msg: BattleMessage | undefined
      try {
        msg = parseQueueBody(typeof req.body === 'string' ? req.body : '')
      } catch {
        await withEvent(deps.logger, 'queue', { poison: 'UNPARSEABLE' }, async () => {})
        res.status(200).json({ ok: true, ignored: 'UNPARSEABLE' })
        return
      }

      // The queue event continues the traceId of the request that started the battle
      const message = msg
      // Pub/Sub push counts deliveries of one message (verify-early §17); > 1 means a redelivery
      const attempt = Number(req.get('x-goog-pubsub-delivery-attempt'))
      const fields = { battleId: message.battleId, ...(attempt > 0 ? { deliveryAttempt: attempt } : {}) }
      const result = await withEvent(deps.logger, 'queue', fields, async (ev) => {
        const r = await runBattleMessage(deps, message)
        ev.set({ result: r, ...(r === 'unknown' ? { poison: 'UNKNOWN_BATTLE' } : {}) })
        return r
      }, message.traceId).catch(() => 'error' as const)

      if (result === 'busy') res.status(503).json({ error: 'BUSY' })
      else if (result === 'error') res.status(500).json({ error: 'RETRY' })
      else res.status(200).json({ ok: true, result })
    },
  ]
}
