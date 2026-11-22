import express, { type Express } from 'express'
import pkg from '../package.json' with { type: 'json' }
import type { Deps } from './deps'
import { errorHandler, wideEventMiddleware } from './log/middleware'

/** Builds the Express app. index.ts starts it; tests call it through supertest. */
export function createApp(deps: Deps): Express {
  const app = express()
  app.disable('x-powered-by') // don't advertise the framework

  app.use(wideEventMiddleware(deps.logger)) // first, so every request gets one event

  // Answers on the deployed URL to prove the server is up.
  app.get('/health', (_req, res) => {
    res.json({ ok: true, version: pkg.version })
  })

  app.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' })
  })
  app.use(errorHandler) // last
  return app
}
