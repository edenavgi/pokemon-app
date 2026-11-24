// PokéAPI cache in monday code's key-value Storage (Phase 2, Task 13).
//
// Cache-aside: the loaders (src/api/pokeapi/loaders.ts) ask the cache first; on a miss they fetch
// from PokéAPI and store the result with a TTL. Storage outlives deploys and is shared by every
// server instance in the account, so after the first fetch every later one is a hit.
//
// Only PokéAPI goes through here. Game state (levels, energy, status) is never cached: it lives
// on the boards, people change it in monday at any time, and a cached copy would be stale.
import type { PokeCache } from '@app/api/pokeapi/loaders'
import { currentEvent, type WideEvent } from '../log/wideEvent'

/**
 * The part of @mondaycom/apps-sdk Storage we use. A missing key answers { success: true, value: null }.
 * Storage keeps STRINGS: an object passed to set is stored as "[object Object]" (verify-early §19),
 * so values go in as JSON text and come out through JSON.parse.
 */
export interface KvPort {
  get(key: string): Promise<{ success: boolean; value?: unknown; error?: string }>
  set(key: string, value: unknown, opts: { ttl: number }): Promise<{ success: boolean; error?: string }>
}

/** The event lists the keys it read, up to this many (the counts always include all). */
export const MAX_CACHE_KEYS_ON_EVENT = 20

/** Values are stored as JSON of { v: value }, so a cached null (a status move) differs from a missing key. */
interface Box<T> {
  v: T
}

interface CacheStats {
  cache: { hits: number; misses: number }
  cacheKeys: string[]
}
const statsByEvent = new WeakMap<WideEvent, CacheStats>()

/** This event's cache counters, created (and put on the event) on first use. */
function statsOf(ev: WideEvent): CacheStats {
  let stats = statsByEvent.get(ev)
  if (!stats) {
    stats = { cache: { hits: 0, misses: 0 }, cacheKeys: [] }
    statsByEvent.set(ev, stats)
    ev.set(stats as unknown as Record<string, unknown>) // the same objects: later counts show up on emit
  }
  return stats
}

/** A Storage failure never fails the request: it's counted, the last message kept, and the read is a miss. */
function storageFailed(op: 'get' | 'set', key: string, err: unknown): void {
  const ev = currentEvent()
  if (!ev) return
  ev.inc('cacheErrors')
  ev.set({ cacheError: { op, key, message: err instanceof Error ? err.message : String(err) } })
}

/** Stored text → the value, or undefined for a missing key or text that isn't one of our boxes. */
function unbox<T>(stored: unknown): T | undefined {
  if (typeof stored !== 'string') return undefined
  try {
    const box = JSON.parse(stored) as unknown
    return box !== null && typeof box === 'object' && 'v' in box ? (box as Box<T>).v : undefined
  } catch {
    return undefined // e.g. "[object Object]" from before this fix: a miss, and the next set repairs it
  }
}

export class KvCache implements PokeCache {
  constructor(private readonly kv: KvPort) {}

  async get<T>(key: string): Promise<T | undefined> {
    let found: T | undefined
    try {
      const res = await this.kv.get(key)
      if (!res.success) throw new Error(res.error ?? 'Storage get failed')
      found = unbox<T>(res.value)
    } catch (err) {
      storageFailed('get', key, err)
    }
    const ev = currentEvent()
    if (ev) {
      const stats = statsOf(ev)
      if (found === undefined) stats.cache.misses++
      else stats.cache.hits++
      if (stats.cacheKeys.length < MAX_CACHE_KEYS_ON_EVENT) stats.cacheKeys.push(key)
    }
    return found
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      const res = await this.kv.set(key, JSON.stringify({ v: value } satisfies Box<T>), { ttl: ttlSeconds })
      if (!res.success) throw new Error(res.error ?? 'Storage set failed')
    } catch (err) {
      storageFailed('set', key, err)
    }
  }
}
