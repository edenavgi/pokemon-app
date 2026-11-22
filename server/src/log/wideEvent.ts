// Wide event logging: one rich, structured event per unit of work (one HTTP request,
// one queue message, one cron run), emitted ONCE at the end, instead of many scattered
// log lines. Every event carries a traceId, so one action can be followed end to end.
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

/** The part of the monday code SDK Logger we use. Its methods take strings only. */
export interface LoggerPort {
  info(msg: string): void
  error(msg: string, opts?: { error?: Error }): void
}

export type EventKind = 'http' | 'queue' | 'cron' | 'boot'

// Keys whose values must never reach a log. "code" is the OAuth authorization code
// (matched exactly, so statusCode and errorCode stay visible).
const SECRET_KEY = /token|secret|authorization|verifier|password|^code$/i
const REDACTED = '[redacted]'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** A copy of `value` with every secret-looking key replaced by "[redacted]", at any depth. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? REDACTED : redact(v)]),
    )
  }
  return value
}

export class WideEvent {
  readonly traceId: string
  private readonly fields: Record<string, unknown>
  private readonly startedAt = performance.now()
  private failure?: Error
  private emitted = false

  constructor(
    readonly kind: EventKind,
    fields: Record<string, unknown> = {},
    traceId: string = randomUUID(),
  ) {
    this.traceId = traceId
    this.fields = { ...fields }
  }

  /** Adds or overwrites fields. */
  set(fields: Record<string, unknown>): void {
    Object.assign(this.fields, fields)
  }

  /** Adds `by` to a numeric counter field (starting from 0). */
  inc(key: string, by = 1): void {
    const current = this.fields[key]
    this.fields[key] = (typeof current === 'number' ? current : 0) + by
  }

  /** Marks the unit of work as failed. The event will go out through logger.error. */
  error(err: unknown): void {
    this.failure = err instanceof Error ? err : new Error(String(err))
    this.fields.error = { name: this.failure.name, message: this.failure.message }
  }

  /** Writes the event as one JSON line. A second call does nothing. */
  emit(logger: LoggerPort): void {
    if (this.emitted) return
    this.emitted = true
    const event = redact({
      kind: this.kind,
      traceId: this.traceId,
      ...this.fields,
      durationMs: Math.round(performance.now() - this.startedAt),
    })
    const line = JSON.stringify(event)
    if (this.failure) logger.error(line, { error: this.failure })
    else logger.info(line)
  }
}

// AsyncLocalStorage keeps "the current event" attached to everything that runs from
// inside run(), including after awaits, so deep code can add fields without the event
// being passed through every function.
const storage = new AsyncLocalStorage<WideEvent>()

/** The event of the unit of work we are inside, or undefined outside of one. */
export function currentEvent(): WideEvent | undefined {
  return storage.getStore()
}

/** Runs `fn` with `ev` as the current event (used by the HTTP middleware). */
export function runWithEvent<T>(ev: WideEvent, fn: () => T): T {
  return storage.run(ev, fn)
}

/**
 * Runs one unit of work inside its own wide event and emits it once at the end.
 * A thrown error is recorded on the event and rethrown.
 */
export async function withEvent<T>(
  logger: LoggerPort,
  kind: EventKind,
  fields: Record<string, unknown>,
  fn: (ev: WideEvent) => Promise<T>,
  traceId?: string,
): Promise<T> {
  const ev = new WideEvent(kind, fields, traceId)
  try {
    return await storage.run(ev, () => fn(ev))
  } catch (err) {
    ev.error(err)
    throw err
  } finally {
    ev.emit(logger)
  }
}
