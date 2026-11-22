// /api/me: what the server knows about the calling user (the app's Connect tab, Task 5).
import express, { Router } from 'express'
import type { Deps } from '../deps'
import type { Session } from '../auth/sessionToken'

export function meRoutes(deps: Pick<Deps, 'repos'>): Router {
  const router = Router()

  // Is this user connected (has gone through OAuth), do we know their boards, is Telegram linked?
  router.get('/', async (_req, res) => {
    const { userId } = res.locals.session as Session
    const [user, link] = await Promise.all([deps.repos.users.get(userId), deps.repos.links.getByUser(userId)])
    res.json({
      connected: user !== null,
      boardsKnown: Boolean(user?.gymsBoardId && user?.pokemonBoardId),
      telegram: { linked: link !== null },
    })
  })

  // The app sends the boards it uses; the bot and the cron job read them from here.
  router.put('/boards', express.json(), async (req, res) => {
    const { userId } = res.locals.session as Session
    const { gymsBoardId, pokemonBoardId } = (req.body ?? {}) as Record<string, unknown>
    const isId = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
    if (!isId(gymsBoardId) || !isId(pokemonBoardId)) {
      res.status(400).json({ error: 'BAD_BOARDS' })
      return
    }
    const saved = await deps.repos.users.setBoards(userId, { gymsBoardId, pokemonBoardId })
    if (!saved) {
      res.status(409).json({ error: 'NOT_CONNECTED' }) // connect with OAuth first (Task 4)
      return
    }
    res.status(204).end()
  })

  return router
}
