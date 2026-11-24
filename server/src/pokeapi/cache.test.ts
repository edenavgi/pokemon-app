import { describe, expect, it, vi } from 'vitest'
import { CACHE_KEYS, POKEAPI, POKEAPI_TTL_SECONDS, createPokeApi } from '@app/api/pokeapi/loaders'
import { WideEvent, runWithEvent } from '../log/wideEvent'
import { telegramSetup } from '../../test/telegramHarness'
import { KvCache, MAX_CACHE_KEYS_ON_EVENT, type KvPort } from './cache'

/**
 * monday's key-value Storage in memory, as it behaves live (verify-early §19): it keeps STRINGS, so an
 * object passed to set comes back as "[object Object]"; a missing key answers { success: true, value: null }.
 */
function fakeKv() {
  const data = new Map<string, string>()
  const kv = {
    data,
    get: vi.fn(async (key: string) => ({ success: true, value: data.get(key) ?? null })),
    set: vi.fn(async (key: string, value: unknown, _opts: { ttl: number }) => {
      data.set(key, String(value))
      return { success: true }
    }),
  } satisfies KvPort & { data: Map<string, string> }
  return kv
}

/** PokéAPI's raw answers for Charmander (dex 4), counted by URL. */
function fakeFetch() {
  const routes: Record<string, unknown> = {
    [`${POKEAPI}/pokemon/4`]: {
      types: [{ type: { name: 'fire' } }],
      stats: [
        { base_stat: 39, stat: { name: 'hp' } }, { base_stat: 52, stat: { name: 'attack' } },
        { base_stat: 43, stat: { name: 'defense' } }, { base_stat: 65, stat: { name: 'speed' } },
      ],
      sprites: { front_default: 'https://sprites.test/4.png' },
      moves: [],
    },
    [`${POKEAPI}/pokemon-species/4`]: {
      names: [{ name: 'Charmander', language: { name: 'en' } }],
      flavor_text_entries: [{ flavor_text: 'Obviously prefers hot places.', language: { name: 'en' } }],
      evolution_chain: { url: `${POKEAPI}/evolution-chain/2/` },
    },
  }
  const urls: string[] = []
  const fetchJson = async <T,>(url: string): Promise<T> => {
    urls.push(url)
    if (!(url in routes)) throw new Error(`PokéAPI 404: ${url}`)
    return structuredClone(routes[url]) as T
  }
  return { fetchJson, urls }
}

/** The loaders store without waiting; let that write land. */
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('KvCache (cache-aside over key-value Storage)', () => {
  it('miss → fetch → set with ttl 2592000 → hit on the second call', async () => {
    const kv = fakeKv()
    const { fetchJson, urls } = fakeFetch()
    const first = await createPokeApi(fetchJson, new KvCache(kv)).getSpecies(4)
    await settle()
    expect(urls).toHaveLength(2) // pokemon/4 + pokemon-species/4
    expect(POKEAPI_TTL_SECONDS).toBe(2_592_000)
    expect(kv.set).toHaveBeenCalledWith(CACHE_KEYS.species(4), expect.anything(), { ttl: 2_592_000 })

    // a new loader object (a new request, another server instance): only Storage can help
    const again = await createPokeApi(fetchJson, new KvCache(kv)).getSpecies(4)
    expect(again).toEqual(first)
    expect(urls).toHaveLength(2)
  })

  it('a value stored by the first version ("[object Object]") is a miss, and the next set repairs it', async () => {
    const kv = fakeKv()
    kv.data.set('k', '[object Object]')
    const cache = new KvCache(kv)
    expect(await cache.get('k')).toBeUndefined()
    await cache.set('k', { a: 1 }, 60)
    expect(await cache.get('k')).toEqual({ a: 1 })
  })

  it('a stored null (e.g. a status move) is a hit, not a miss', async () => {
    const kv = fakeKv()
    const cache = new KvCache(kv)
    await cache.set(CACHE_KEYS.move('growl'), null, POKEAPI_TTL_SECONDS)
    expect(await cache.get(CACHE_KEYS.move('growl'))).toBeNull()
    expect(await cache.get(CACHE_KEYS.move('tackle'))).toBeUndefined()
  })

  it('records hits, misses and the keys on the current event', async () => {
    const kv = fakeKv()
    const cache = new KvCache(kv)
    await cache.set('k1', 1, 60)
    const ev = new WideEvent('http')
    await runWithEvent(ev, async () => {
      await cache.get('k1')
      await cache.get('k2')
    })
    const fields = eventFields(ev)
    expect(fields.cache).toEqual({ hits: 1, misses: 1 })
    expect(fields.cacheKeys).toEqual(['k1', 'k2'])
  })

  it(`keeps at most ${MAX_CACHE_KEYS_ON_EVENT} keys on the event, but counts them all`, async () => {
    const cache = new KvCache(fakeKv())
    const ev = new WideEvent('http')
    await runWithEvent(ev, async () => {
      for (let i = 0; i < 25; i++) await cache.get(`k${i}`)
    })
    const fields = eventFields(ev)
    expect(fields.cache).toEqual({ hits: 0, misses: 25 })
    expect(fields.cacheKeys).toHaveLength(MAX_CACHE_KEYS_ON_EVENT)
  })

  it('a Storage error is a miss, not a failure (thrown or success: false), and it is on the event', async () => {
    const { fetchJson } = fakeFetch()
    const throwing: KvPort = {
      get: async () => { throw new Error('storage down') },
      set: async () => { throw new Error('storage down') },
    }
    const refusing: KvPort = {
      get: async () => ({ success: false, error: 'quota' }),
      set: async () => ({ success: false, error: 'quota' }),
    }
    for (const kv of [throwing, refusing]) {
      const ev = new WideEvent('http')
      const species = await runWithEvent(ev, async () => {
        const s = await createPokeApi(fetchJson, new KvCache(kv)).getSpecies(4)
        await settle()
        return s
      })
      expect(species.name).toBe('Charmander')
      const fields = eventFields(ev)
      expect(fields.cache).toEqual({ hits: 0, misses: 1 })
      expect(fields.cacheErrors).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('the cache on the server', () => {
  const setupWithCache = async () => {
    const kv = fakeKv()
    const { fetchJson, urls } = fakeFetch()
    const t = await telegramSetup({ pokeApiFor: () => createPokeApi(fetchJson, new KvCache(kv)) })
    await t.linkedChat()
    return { ...t, kv, urls }
  }
  const webhookEvents = (t: Awaited<ReturnType<typeof setupWithCache>>) =>
    t.log.events().filter((e) => e.path === '/telegram/webhook')

  it('/talk twice: the first event has a miss, the second a hit, and PokéAPI is fetched once', async () => {
    const t = await setupWithCache()
    await t.say('555', '/talk charmander')
    await settle()
    await t.say('555', '/talk charmander')
    const [first, second] = webhookEvents(t)
    expect(first.cache).toEqual({ hits: 0, misses: 1 })
    expect(second.cache).toEqual({ hits: 1, misses: 0 })
    expect(second.cacheKeys).toEqual([CACHE_KEYS.species(4)])
    expect(t.urls).toHaveLength(2)
  })

  it('board data never goes through the cache: /roster makes no Storage calls', async () => {
    const t = await setupWithCache()
    await t.say('555', '/roster cinnabar')
    expect(t.repliesTo('555')[0]).toMatch(/^Cinnabar Gym/)
    expect(t.kv.get).not.toHaveBeenCalled()
    expect(t.kv.set).not.toHaveBeenCalled()
    expect(webhookEvents(t)[0].cache).toBeUndefined()
  })
})

/** The fields an event would log (emit through a capturing logger). */
function eventFields(ev: WideEvent): Record<string, unknown> {
  let line = ''
  ev.emit({ info: (l: string) => void (line = l), error: (l: string) => void (line = l) })
  return JSON.parse(line)
}
