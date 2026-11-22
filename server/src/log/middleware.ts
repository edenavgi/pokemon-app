import type { ErrorRequestHandler, Request, RequestHandler } from 'express'
import { WideEvent, runWithEvent, type LoggerPort } from './wideEvent'

/** The route pattern ("/battles/:id"), so logs group by route and never hold IDs from the URL. */
function routePath(req: Request): string {
  const route = req.route as { path?: unknown } | undefined
  return typeof route?.path === 'string' ? req.baseUrl + route.path : req.path
}

/**
 * Starts one wide event per HTTP request and emits it when the response is done.
 * The event is also on res.locals.wideEvent, and is currentEvent() for the whole request.
 */
export function wideEventMiddleware(logger: LoggerPort): RequestHandler {
  return (req, res, next) => {
    const ev = new WideEvent('http', { method: req.method })
    res.locals.wideEvent = ev

    const done = (aborted: boolean) => {
      ev.set({ path: routePath(req), status: res.statusCode, ...(aborted ? { aborted: true } : {}) })
      ev.emit(logger) // emits once even if both events fire
    }
    res.on('finish', () => done(false))
    res.on('close', () => done(!res.writableFinished))

    runWithEvent(ev, next)
  }
}

/** Last middleware: a thrown error becomes a JSON 500 (no stack trace to the caller) and is logged. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const ev = res.locals.wideEvent as WideEvent | undefined
  ev?.error(err)
  if (res.headersSent) return
  res.status(500).json({ error: 'INTERNAL' })
}
