import { describe, expect, it } from 'vitest'
import { POKEAPI, createPokeApi, memoryPokeCache, type PokeCache } from './loaders'

/** A fetch that answers by URL and counts calls. Unknown URLs fail like a 404. */
function fakeFetch(routes: Record<string, unknown>) {
  const urls: string[] = []
  const fetchJson = async <T,>(url: string): Promise<T> => {
    urls.push(url)
    if (!(url in routes)) throw new Error(`PokéAPI 404: ${url}`)
    return structuredClone(routes[url]) as T
  }
  return { fetchJson, urls }
}

const charmanderPokemon = (moves: unknown[] = []) => ({
  types: [{ type: { name: 'fire' } }],
  stats: [
    { base_stat: 39, stat: { name: 'hp' } }, { base_stat: 52, stat: { name: 'attack' } },
    { base_stat: 43, stat: { name: 'defense' } }, { base_stat: 65, stat: { name: 'speed' } },
  ],
  sprites: { front_default: 'https://sprites.test/4.png' },
  moves,
})
const charmanderSpecies = {
  names: [{ name: 'Charmander', language: { name: 'en' } }],
  flavor_text_entries: [{ flavor_text: 'Obviously prefers\nhot places.', language: { name: 'en' } }],
  evolution_chain: { url: `${POKEAPI}/evolution-chain/2/` },
}

// A move learned by level-up at `level` in one version group
const learned = (name: string, level: number, method = 'level-up') => ({
  move: { name, url: `${POKEAPI}/move/${name}/` },
  version_group_details: [{ level_learned_at: level, move_learn_method: { name: method } }],
})
const moveDetail = (name: string, type: string, power: number | null, damageClass = 'special') => ({
  name,
  power,
  type: { name: type },
  damage_class: { name: damageClass },
  names: [{ name: name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '), language: { name: 'en' } }],
})

describe('getSpecies', () => {
  const routes = {
    [`${POKEAPI}/pokemon/4`]: charmanderPokemon(),
    [`${POKEAPI}/pokemon-species/4`]: charmanderSpecies,
  }

  it('maps PokéAPI to SpeciesDetail', async () => {
    const { fetchJson } = fakeFetch(routes)
    expect(await createPokeApi(fetchJson, memoryPokeCache()).getSpecies(4)).toEqual({
      dexNumber: 4, name: 'Charmander', types: ['Fire'], spriteUrl: 'https://sprites.test/4.png',
      hp: 39, attack: 52, defense: 43, speed: 65, flavorText: 'Obviously prefers hot places.',
    })
  })

  it('uses the cache on the second call', async () => {
    const { fetchJson, urls } = fakeFetch(routes)
    const cache = memoryPokeCache()
    await createPokeApi(fetchJson, cache).getSpecies(4)
    await createPokeApi(fetchJson, cache).getSpecies(4) // a new instance: only the cache can help
    expect(urls).toHaveLength(2)
  })

  it('two concurrent calls share one set of requests', async () => {
    const { fetchJson, urls } = fakeFetch(routes)
    const api = createPokeApi(fetchJson, memoryPokeCache())
    await Promise.all([api.getSpecies(4), api.getSpecies(4)])
    expect(urls).toHaveLength(2)
  })

  it('a broken cache is treated as a miss, not a failure', async () => {
    const { fetchJson } = fakeFetch(routes)
    const broken: PokeCache = {
      get: async () => { throw new Error('storage down') },
      set: async () => { throw new Error('storage down') },
    }
    expect((await createPokeApi(fetchJson, broken).getSpecies(4)).name).toBe('Charmander')
  })

  it('does not cache a failure', async () => {
    const live: Record<string, unknown> = { ...routes }
    const { fetchJson, urls } = fakeFetch(live)
    delete live[`${POKEAPI}/pokemon/4`]
    const api = createPokeApi(fetchJson, memoryPokeCache())
    await expect(api.getSpecies(4)).rejects.toThrow('404')
    live[`${POKEAPI}/pokemon/4`] = charmanderPokemon()
    expect((await api.getSpecies(4)).name).toBe('Charmander')
    expect(urls.length).toBeGreaterThan(2)
  })
})

describe('getEvolution', () => {
  it('counts Gen-1 stages only (Pichu #172 does not make Pikachu stage 2)', async () => {
    const node = (dex: number, name: string, evolves_to: unknown[] = [], details: unknown[] = []) => ({
      species: { name, url: `${POKEAPI}/pokemon-species/${dex}/` }, evolution_details: details, evolves_to,
    })
    const { fetchJson } = fakeFetch({
      [`${POKEAPI}/pokemon-species/25`]: { ...charmanderSpecies, evolution_chain: { url: `${POKEAPI}/evolution-chain/10/` } },
      [`${POKEAPI}/evolution-chain/10/`]: {
        chain: node(172, 'pichu', [node(25, 'pikachu', [node(26, 'raichu', [], [{ trigger: { name: 'use-item' }, min_level: null }])])]),
      },
    })
    expect(await createPokeApi(fetchJson, memoryPokeCache()).getEvolution(25)).toEqual({
      stage: 1, next: [{ dexNumber: 26, name: 'Raichu', trigger: 'other', minLevel: null }],
    })
  })
})

describe('getTypeChart and listGen1', () => {
  // 18 type/{name} responses; only Fire has data, the rest are empty
  const types = ['normal', 'fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'poison', 'ground',
    'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy']
  const routes = Object.fromEntries(types.map((t) => [`${POKEAPI}/type/${t}`, {
    name: t,
    damage_relations: t === 'fire'
      ? { double_damage_to: [{ name: 'grass' }], half_damage_to: [{ name: 'water' }], no_damage_to: [] }
      : { double_damage_to: [], half_damage_to: [], no_damage_to: [] },
    pokemon: t === 'fire'
      ? [{ slot: 1, pokemon: { name: 'charmander', url: `${POKEAPI}/pokemon/4/` } },
         { slot: 1, pokemon: { name: 'charmander-gmax', url: `${POKEAPI}/pokemon/10196/` } }]
      : t === 'normal' ? [{ slot: 1, pokemon: { name: 'farfetchd', url: `${POKEAPI}/pokemon/83/` } }] : [],
  }]))

  it('getTypeChart builds attacker → defender multipliers', async () => {
    const { fetchJson } = fakeFetch(routes)
    const chart = await createPokeApi(fetchJson, memoryPokeCache()).getTypeChart()
    expect(chart.Fire).toEqual({ Grass: 2, Water: 0.5 })
  })

  it('listGen1 keeps dex ≤ 151, fixes special names, and shares the 18 type requests with getTypeChart', async () => {
    const { fetchJson, urls } = fakeFetch(routes)
    const api = createPokeApi(fetchJson, memoryPokeCache())
    const [list] = await Promise.all([api.listGen1(), api.getTypeChart()])
    expect(list.map((s) => s.name)).toEqual(['Charmander', 'Farfetch’d'])
    expect(urls).toHaveLength(18)
  })
})

describe('getMoveset', () => {
  const pokemonWith = (moves: unknown[]) => ({ [`${POKEAPI}/pokemon/4`]: charmanderPokemon(moves) })

  it('keeps the first 4 damaging level-up moves in learn order', async () => {
    const { fetchJson } = fakeFetch({
      ...pokemonWith([
        learned('ember', 9), learned('growl', 1), learned('scratch', 1), learned('flamethrower', 38),
        learned('fire-spin', 41), learned('slash', 30), learned('dragon-rage', 22), learned('fire-punch', 0, 'machine'),
      ]),
      [`${POKEAPI}/move/growl`]: moveDetail('growl', 'normal', null, 'status'),
      [`${POKEAPI}/move/scratch`]: moveDetail('scratch', 'normal', 40, 'physical'),
      [`${POKEAPI}/move/ember`]: moveDetail('ember', 'fire', 40),
      [`${POKEAPI}/move/dragon-rage`]: moveDetail('dragon-rage', 'dragon', null), // fixed damage: no power
      [`${POKEAPI}/move/slash`]: moveDetail('slash', 'normal', 70, 'physical'),
      [`${POKEAPI}/move/flamethrower`]: moveDetail('flamethrower', 'fire', 90),
      [`${POKEAPI}/move/fire-spin`]: moveDetail('fire-spin', 'fire', 35),
    })
    expect(await createPokeApi(fetchJson, memoryPokeCache()).getMoveset(4)).toEqual([
      { name: 'Scratch', type: 'Normal', power: 40 },
      { name: 'Ember', type: 'Fire', power: 40 },
      { name: 'Slash', type: 'Normal', power: 70 },
      { name: 'Flamethrower', type: 'Fire', power: 90 },
    ])
  })

  it('stops after 12 candidates', async () => {
    const names = Array.from({ length: 20 }, (_, i) => `status-move-${i}`)
    const { fetchJson, urls } = fakeFetch({
      ...pokemonWith(names.map((n, i) => learned(n, i))),
      ...Object.fromEntries(names.map((n) => [`${POKEAPI}/move/${n}`, moveDetail(n, 'normal', null, 'status')])),
    })
    expect(await createPokeApi(fetchJson, memoryPokeCache()).getMoveset(4)).toEqual([])
    expect(urls.filter((u) => u.includes('/move/'))).toHaveLength(12)
  })

  it('returns [] when no damaging move exists', async () => {
    const { fetchJson } = fakeFetch({
      ...pokemonWith([learned('splash', 1)]),
      [`${POKEAPI}/move/splash`]: moveDetail('splash', 'normal', null, 'status'),
    })
    expect(await createPokeApi(fetchJson, memoryPokeCache()).getMoveset(4)).toEqual([])
  })
})
