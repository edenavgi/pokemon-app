// Every PokéAPI call the game makes, with a cache-aside layer.
// It doesn't know WHERE the cache lives: the caller passes a PokeCache.
//   - the app: memory + global SDK storage (src/api/monday/index.ts)
//   - the server: key-value Storage with a TTL (Phase 2, Task 13)
import {
  POKE_TYPES,
  type Effectiveness, type EvolutionInfo, type EvolutionTarget, type Move, type PokeType,
  type SpeciesDetail, type SpeciesSummary, type TypeChart,
} from '../GameApi'
import { cleanFlavorText } from './flavorText'

export const POKEAPI = 'https://pokeapi.co/api/v2'

/** Where loaded results are kept. Errors from it are treated as a miss, never as a failure. */
export interface PokeCache {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>
}

/** 30 days: the longest TTL monday's key-value Storage allows. Gen-1 data never changes. */
export const POKEAPI_TTL_SECONDS = 30 * 24 * 60 * 60

/** Cache keys (≤ 256 chars). The first two are the v1 SDK-storage keys, kept so stored data stays valid. */
export const CACHE_KEYS = {
  typeChart: 'pokeapi:typeChart:v1',
  gen1: 'pokeapi:gen1:v1',
  species: (dex: number) => `pokeapi:species:v1:${dex}`,
  evolution: (dex: number) => `pokeapi:evolution:v1:${dex}`,
  chain: (url: string) => `pokeapi:chain:v1:${url.split('/').filter(Boolean).pop()}`,
  moveset: (dex: number) => `pokeapi:moveset:v1:${dex}`,
  move: (name: string) => `pokeapi:move:v1:${name}`,
} as const

/** A cache that lives as long as the object (one page load in the app, one test). */
export function memoryPokeCache(): PokeCache {
  const map = new Map<string, unknown>()
  return {
    get: async <T>(key: string) => map.get(key) as T | undefined,
    set: async (key, value) => void map.set(key, value),
  }
}

export type FetchJson = <T>(url: string) => Promise<T>

/** The real fetch: one GET, a clear error on a non-2xx answer. */
export async function fetchPokeApi<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`PokéAPI ${res.status}: ${url}`)
  return (await res.json()) as T
}

// ---------- PokéAPI response shapes (only the parts we use, see pokeapi.co/docs/v2) ----------

interface PokeApiPokemon {
  types: { type: { name: string } }[]
  stats: { base_stat: number; stat: { name: string } }[]
  sprites: { front_default: string | null }
  moves?: { move: { name: string }; version_group_details: { level_learned_at: number; move_learn_method: { name: string } }[] }[]
}
interface PokeApiSpecies {
  names: { name: string; language: { name: string } }[]
  flavor_text_entries: { flavor_text: string; language: { name: string } }[]
  evolution_chain: { url: string }
}
// One node of evolution-chain/{id}: a species and the forms it evolves into (a tree)
interface ChainNode {
  species: { name: string; url: string }
  evolution_details: { trigger: { name: string }; min_level: number | null }[]
  evolves_to: ChainNode[]
}
// One type/{name} response gives BOTH that type's damage row AND every Pokémon of that type
interface PokeApiType {
  name: string
  damage_relations: Record<'double_damage_to' | 'half_damage_to' | 'no_damage_to', { name: string }[]>
  pokemon: { slot: number; pokemon: { name: string; url: string } }[] // slot 1 = primary type
}
interface PokeApiMove {
  name: string
  power: number | null
  type: { name: string }
  damage_class: { name: string }
  names: { name: string; language: { name: string } }[]
}

// ---------- pure helpers ----------

const GEN1_MAX = 151
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
// ".../pokemon-species/5/" → 5
const dexFromUrl = (url: string) => Number(url.split('/').filter(Boolean).pop())
const english = <T extends { language: { name: string } }>(list: T[]) => list.find((x) => x.language.name === 'en')
const asPokeType = (name: string): PokeType | null => {
  const t = capitalize(name) as PokeType
  return (POKE_TYPES as readonly string[]).includes(t) ? t : null
}

// Same URL as pokemon/{n}.sprites.front_default, so the grid needs no request per Pokémon
const SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon'

// The only Gen-1 slugs whose English name isn't the slug capitalized (as getSpecies shows them)
const SPECIAL_NAMES: Record<string, string> = {
  'nidoran-f': 'Nidoran♀', 'nidoran-m': 'Nidoran♂', 'mr-mime': 'Mr. Mime', farfetchd: 'Farfetch’d',
}

// The path from the chain's root to `dex`: [charmander, charmeleon] for 5
function pathTo(node: ChainNode, dex: number, path: ChainNode[] = []): ChainNode[] | null {
  const here = [...path, node]
  if (dexFromUrl(node.species.url) === dex) return here
  for (const child of node.evolves_to) {
    const found = pathTo(child, dex, here)
    if (found) return found
  }
  return null
}

// A next form → EvolutionTarget. "level-up" only when some game version gives a min_level;
// friendship, stones and trades all count as "other".
function toTarget(node: ChainNode): EvolutionTarget {
  const byLevel = node.evolution_details.find((d) => d.trigger.name === 'level-up' && d.min_level !== null)
  return {
    dexNumber: dexFromUrl(node.species.url),
    name: capitalize(node.species.name),
    trigger: byLevel ? 'level-up' : 'other',
    minLevel: byLevel?.min_level ?? null,
  }
}

// chart[attacker][defender]: 2, 0.5 or 0; a missing entry means 1
function toTypeChart(types: PokeApiType[]): TypeChart {
  const chart = {} as TypeChart
  for (const t of types) {
    const row: Partial<Record<PokeType, Effectiveness>> = {}
    const set = (targets: { name: string }[], value: Effectiveness) =>
      targets.forEach((d) => (row[capitalize(d.name) as PokeType] = value))
    set(t.damage_relations.double_damage_to, 2)
    set(t.damage_relations.half_damage_to, 0.5)
    set(t.damage_relations.no_damage_to, 0)
    chart[capitalize(t.name) as PokeType] = row
  }
  return chart
}

// Turns the 18 type lists around: dex → its name and its types (primary first)
function toGen1(types: PokeApiType[]): SpeciesSummary[] {
  const byDex = new Map<number, { slug: string; types: { slot: number; type: PokeType }[] }>()
  for (const t of types) {
    for (const { slot, pokemon } of t.pokemon) {
      const dex = dexFromUrl(pokemon.url)
      if (dex > GEN1_MAX) continue // later generations and alternate forms (ids 10000+)
      const entry = byDex.get(dex) ?? { slug: pokemon.name, types: [] }
      entry.types.push({ slot, type: capitalize(t.name) as PokeType })
      byDex.set(dex, entry)
    }
  }
  return [...byDex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dexNumber, e]) => ({
      dexNumber,
      name: SPECIAL_NAMES[e.slug] ?? capitalize(e.slug),
      types: e.types.sort((a, b) => a.slot - b.slot).map((x) => x.type),
      spriteUrl: `${SPRITES}/${dexNumber}.png`,
    }))
}

// Level-up moves, earliest first (then by name), each once
function levelUpMovesInOrder(pokemon: PokeApiPokemon): string[] {
  return (pokemon.moves ?? [])
    .flatMap((m) => {
      const levels = m.version_group_details
        .filter((d) => d.move_learn_method.name === 'level-up')
        .map((d) => d.level_learned_at)
      return levels.length > 0 ? [{ name: m.move.name, level: Math.min(...levels) }] : []
    })
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
    .map((m) => m.name)
}

/** Battle moves: at most 4, chosen from the first 12 level-up moves. */
export const MOVESET_SIZE = 4
export const MOVESET_CANDIDATES = 12

export type PokeApi = ReturnType<typeof createPokeApi>

export function createPokeApi(fetchJson: FetchJson, cache: PokeCache) {
  const inflight = new Map<string, Promise<unknown>>()

  // Cache-aside: cache hit → return it; miss → load, store (without waiting), return.
  // Concurrent calls for the same key share one load. Failures are never stored.
  function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const running = inflight.get(key)
    if (running) return running as Promise<T>
    const p = (async () => {
      let hit: T | undefined
      try {
        hit = await cache.get<T>(key)
      } catch (e) {
        console.warn(`[pokeapi] cache read failed for ${key}`, e)
      }
      if (hit !== undefined) return hit
      const value = await load()
      Promise.resolve()
        .then(() => cache.set(key, value, POKEAPI_TTL_SECONDS))
        .catch((e: unknown) => console.warn(`[pokeapi] cache write failed for ${key}`, e))
      return value
    })()
    inflight.set(key, p)
    p.then(() => inflight.delete(key), () => inflight.delete(key))
    return p
  }

  // The 18 type/{name} responses, shared by getTypeChart and listGen1; kept for this object's life.
  let typesLoad: Promise<PokeApiType[]> | undefined
  function loadTypes(): Promise<PokeApiType[]> {
    if (!typesLoad) {
      typesLoad = Promise.all(POKE_TYPES.map((t) => fetchJson<PokeApiType>(`${POKEAPI}/type/${t.toLowerCase()}`)))
      typesLoad.catch(() => (typesLoad = undefined))
    }
    return typesLoad
  }

  function loadMove(name: string): Promise<Move | null> {
    return cached(CACHE_KEYS.move(name), async () => {
      const m = await fetchJson<PokeApiMove>(`${POKEAPI}/move/${name}`)
      const type = asPokeType(m.type.name)
      if (m.damage_class.name === 'status' || !m.power || m.power <= 0 || !type) return null // not a damaging move
      const display = english(m.names)?.name ?? m.name.split('-').map(capitalize).join(' ')
      return { name: display, type, power: m.power }
    })
  }

  return {
    getSpecies(dexNumber: number): Promise<SpeciesDetail> {
      return cached(CACHE_KEYS.species(dexNumber), async () => {
        const [pokemon, species] = await Promise.all([
          fetchJson<PokeApiPokemon>(`${POKEAPI}/pokemon/${dexNumber}`),
          fetchJson<PokeApiSpecies>(`${POKEAPI}/pokemon-species/${dexNumber}`),
        ])
        const stat = (name: string) => pokemon.stats.find((s) => s.stat.name === name)?.base_stat ?? 0
        const flavor = english(species.flavor_text_entries)
        return {
          dexNumber,
          name: english(species.names)?.name ?? `#${dexNumber}`,
          types: pokemon.types.map((t) => capitalize(t.type.name) as PokeType),
          spriteUrl: pokemon.sprites.front_default ?? '',
          hp: stat('hp'),
          attack: stat('attack'),
          defense: stat('defense'),
          speed: stat('speed'),
          flavorText: flavor ? cleanFlavorText(flavor.flavor_text) : '',
        }
      })
    },

    getEvolution(dexNumber: number): Promise<EvolutionInfo> {
      return cached(CACHE_KEYS.evolution(dexNumber), async () => {
        const species = await fetchJson<PokeApiSpecies>(`${POKEAPI}/pokemon-species/${dexNumber}`)
        const url = species.evolution_chain.url
        // Several Pokémon share one chain (Charmander, Charmeleon, Charizard) → fetch each chain once
        const { chain } = await cached(CACHE_KEYS.chain(url), () => fetchJson<{ chain: ChainNode }>(url))
        const path = pathTo(chain, dexNumber)
        if (!path) throw new Error(`#${dexNumber} is not in its own evolution chain`)
        // Stage counts Gen-1 forms only: Pichu (#172, Gen 2) doesn't make Pikachu stage 2
        const gen1Steps = path.filter((n) => dexFromUrl(n.species.url) <= GEN1_MAX).length
        const stage = Math.min(Math.max(gen1Steps, 1), 3) as 1 | 2 | 3
        // `next` is NOT filtered to Gen 1, so evolutionCheck can say "outside Gen 1" (Golbat → Crobat)
        return { stage, next: path[path.length - 1].evolves_to.map(toTarget) }
      })
    },

    getTypeChart(): Promise<TypeChart> {
      return cached(CACHE_KEYS.typeChart, async () => toTypeChart(await loadTypes()))
    },

    listGen1(): Promise<SpeciesSummary[]> {
      return cached(CACHE_KEYS.gen1, async () => {
        const list = toGen1(await loadTypes())
        if (list.length !== GEN1_MAX) console.warn(`[listGen1] expected ${GEN1_MAX} Pokémon, got ${list.length}`)
        return list
      })
    },

    /**
     * Up to 4 damaging moves for the battle engine: the pokemon's level-up moves in learn order,
     * skipping status moves, moves without power and unknown types. Looks at no more than 12.
     */
    getMoveset(dexNumber: number): Promise<Move[]> {
      return cached(CACHE_KEYS.moveset(dexNumber), async () => {
        const pokemon = await fetchJson<PokeApiPokemon>(`${POKEAPI}/pokemon/${dexNumber}`)
        const candidates = levelUpMovesInOrder(pokemon).slice(0, MOVESET_CANDIDATES)
        const moves = await Promise.all(candidates.map(loadMove))
        return moves.filter((m): m is Move => m !== null).slice(0, MOVESET_SIZE)
      })
    },
  }
}
