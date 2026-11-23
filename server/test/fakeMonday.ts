// A fake monday for server tests: the Gyms and Pokémon boards in memory (seeded from the app's
// mock fixtures), answering the GraphQL that the shared board gateway sends — in the shapes
// recorded in docs/verify-early.md §2 and §8. Only the queries the server uses are understood.
import type { GqlRequest } from '@app/api/boards/gateway'
import type { Gym, Pokemon } from '@app/api/GameApi'
import { SEED_GYMS, SEED_POKEMON, SPECIES } from '@app/api/mock/fixtures'

export const GYMS_BOARD = 'board-gyms'
export const POKEMON_BOARD = 'board-pokemon'

// Column title ↔ a fake column id ("Level" → "c_level")
const colId = (title: string) => `c_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
const POKEMON_COLUMNS = ['Pokédex number', 'Types', 'Sprite', 'HP', 'Attack', 'Defense', 'Speed', 'Level', 'Energy', 'Status', 'Gym', 'Gym type (mirror)']
const NUMBER_FIELDS: Record<string, keyof Pokemon> = {
  'Pokédex number': 'dexNumber', HP: 'hp', Attack: 'attack', Defense: 'defense', Speed: 'speed', Level: 'level', Energy: 'energy',
}

export function fakeMonday() {
  const gyms = new Map<string, Omit<Gym, 'roster' | 'mirroredLevels'>>(
    SEED_GYMS.map((g) => [g.id, { id: g.id, name: g.name, type: g.type }]),
  )
  const pokemon = new Map<string, Pokemon>(
    SEED_POKEMON.map((s) => {
      const sp = SPECIES.find((x) => x.dexNumber === s.dexNumber)!
      const gym = s.gymId ? gyms.get(s.gymId)! : null
      return [s.id, {
        id: s.id, name: sp.name, dexNumber: sp.dexNumber, types: [...sp.types], spriteUrl: sp.spriteUrl,
        hp: sp.hp, attack: sp.attack, defense: sp.defense, speed: sp.speed,
        level: s.level, energy: s.energy, status: s.status,
        gym: gym ? { id: gym.id, name: gym.name, type: gym.type } : null,
      }]
    }),
  )
  const updates: { itemId: string; body: string }[] = []
  const writes: { itemId: string; values: Record<string, unknown> }[] = []
  let failWrites = 0
  let failReads = 0

  const cv = (title: string, fields: Record<string, unknown>) => ({ text: null, value: null, column: { title }, ...fields })
  const num = (title: string, n: number) => cv(title, { text: String(n), value: JSON.stringify(String(n)) })

  function pokemonItem(p: Pokemon) {
    return {
      id: p.id,
      name: p.name,
      column_values: [
        ...Object.entries(NUMBER_FIELDS).map(([title, field]) => num(title, p[field] as number)),
        cv('Types', { text: p.types.join(', '), values: p.types.map((label) => ({ label })) }),
        cv('Sprite', { value: JSON.stringify({ url: p.spriteUrl, text: p.name }) }),
        cv('Status', { text: p.status, label: p.status }),
        cv('Gym', { linked_item_ids: p.gym ? [p.gym.id] : [], display_value: p.gym?.name ?? '' }),
        cv('Gym type (mirror)', { display_value: p.gym?.type ?? '' }),
      ],
    }
  }
  const rosterOf = (gymId: string) => [...pokemon.values()].filter((p) => p.gym?.id === gymId)
  function gymItem(g: { id: string; name: string; type: string | null }) {
    const roster = rosterOf(g.id)
    return {
      id: g.id,
      name: g.name,
      column_values: [
        cv('Type', { text: g.type, values: g.type ? [{ label: g.type }] : [] }),
        cv('Pokemon', { linked_item_ids: roster.map((p) => p.id) }),
        cv('Level (mirror)', { display_value: roster.map((p) => p.level).join(', ') }),
      ],
    }
  }

  // Applies { columnId: value } written by change_multiple_column_values
  function applyWrite(itemId: string, values: Record<string, unknown>) {
    const p = pokemon.get(itemId)
    if (!p) throw new Error(`Item ${itemId} not found`)
    for (const [id, value] of Object.entries(values)) {
      const title = POKEMON_COLUMNS.find((t) => colId(t) === id)
      if (title && NUMBER_FIELDS[title]) (p as unknown as Record<string, unknown>)[NUMBER_FIELDS[title]] = Number(value)
      else if (title === 'Status') p.status = (value as { label: Pokemon['status'] }).label
      else throw new Error(`fakeMonday: writing ${id} is not supported`)
    }
  }

  const request: GqlRequest = async <T,>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
    const answer = (data: unknown) => structuredClone(data) as T
    const isWrite = query.includes('create_update') || query.includes('change_multiple_column_values')
    if (!isWrite && failReads > 0) {
      failReads--
      throw new Error('fakeMonday: read failed (simulated)')
    }
    if (query.includes('create_update')) {
      updates.push({ itemId: String(variables.itemId), body: String(variables.body) })
      return answer({ create_update: { id: `u${updates.length}` } })
    }
    if (query.includes('change_multiple_column_values')) {
      if (failWrites > 0) {
        failWrites--
        throw new Error('fakeMonday: write failed (simulated)')
      }
      for (let i = 0; `item${i}` in variables; i++) {
        const values = JSON.parse(String(variables[`values${i}`])) as Record<string, unknown>
        writes.push({ itemId: String(variables[`item${i}`]), values })
        applyWrite(String(variables[`item${i}`]), values)
      }
      return answer({})
    }
    if (query.includes('board { id columns')) {
      const ids = (variables.itemIds as string[]) ?? []
      const columns = POKEMON_COLUMNS.map((title) => ({ id: colId(title), title }))
      return answer({ items: ids.filter((id) => pokemon.has(id)).map((id) => ({ id, board: { id: POKEMON_BOARD, columns } })) })
    }
    if (query.includes('items_page')) {
      const boardIds = (variables.boardIds as string[]) ?? []
      return answer({
        boards: boardIds.map((b) => ({
          items_page: {
            cursor: null,
            items: b === GYMS_BOARD ? [...gyms.values()].map(gymItem) : b === POKEMON_BOARD ? [...pokemon.values()].map(pokemonItem) : [],
          },
        })),
      })
    }
    if (query.includes('items(ids: [$gymId])')) {
      const g = gyms.get(String(variables.gymId))
      return answer({ items: g ? [gymItem(g)] : [] })
    }
    if (query.includes('items(ids: $itemIds')) {
      const ids = (variables.itemIds as string[]) ?? []
      return answer({ items: ids.flatMap((id) => (pokemon.has(id) ? [pokemonItem(pokemon.get(id)!)] : [])) })
    }
    throw new Error(`fakeMonday: query not supported:\n${query}`)
  }

  return {
    request,
    gyms,
    pokemon,
    updates,
    writes,
    boards: { gymsBoardId: GYMS_BOARD, pokemonBoardId: POKEMON_BOARD },
    /** The next `n` column writes fail, like a monday error mid-way. */
    failNextWrites(n = 1) {
      failWrites = n
    },
    /** The next `n` reads (queries) fail, like monday being down. */
    failNextReads(n = 1) {
      failReads = n
    },
  }
}

/** The monday code Queue, in memory. Delivery is done by the test (POST /mndy-queue). */
export function fakeQueue(secret = 'queue-secret') {
  const published: string[] = []
  return {
    published,
    secret,
    onPublish: undefined as undefined | ((message: string) => void | Promise<void>),
    async publishMessage(message: string) {
      await this.onPublish?.(message)
      published.push(message)
      return `msg-${published.length}`
    },
    validateMessageSecret(given: string) {
      if (!given) throw new Error('secret is required.') // like the SDK
      return given === secret
    },
  }
}
