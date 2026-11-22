import cors from 'cors'
import express, { type Express } from 'express'
import pkg from '../package.json' with { type: 'json' }
import { meRoutes } from './api/me'
import { requireSession } from './auth/sessionToken'
import type { Deps } from './deps'
import { errorHandler, wideEventMiddleware } from './log/middleware'

// The app runs in monday's iframe (https://*.monday.com / the CDN on https://*.monday.app),
// so the browser asks before calling us from another origin. Only those origins, the local
// Vite dev server and our own URL may call. Anchored at the end: monday.app.evil.test is out.
const MONDAY_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*monday\.(com|app)$/

function corsFor(deps: Deps) {
  const allowed = new Set(['http://localhost:5173', new URL(deps.config.serverBaseUrl).origin])
  return cors({
    origin: (origin, callback) => {
      // No Origin header = not a browser cross-origin call (curl, Telegram, the queue): nothing to add
      callback(null, origin === undefined || MONDAY_ORIGIN.test(origin) || allowed.has(origin))
    },
  })
}

/** Builds the Express app. index.ts starts it; tests call it through supertest. */
export function createApp(deps: Deps): Express {
  const app = express()
  app.disable('x-powered-by') // don't advertise the framework

  app.use(wideEventMiddleware(deps.logger)) // first, so every request gets one event
  app.use(corsFor(deps))

  // Answers on the deployed URL to prove the server is up.
  app.get('/health', (_req, res) => {
    res.json({ ok: true, version: pkg.version })
  })

  // Everything under /api is called by the app and needs a valid sessionToken
  app.use('/api', requireSession(deps))
  app.use('/api/me', meRoutes(deps))

  app.use((_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND' })
  })
  app.use(errorHandler) // last
  return app
}
