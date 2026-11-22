import { describe, expect, it } from 'vitest'
import { createBoardGateway, type GqlRequest } from './gateway'

// Column value shapes as recorded in docs/verify-early.md §2 (API 2026-10)
type Cv = Record<string, unknown> & { column: { title: string } }
const cv = (title: string, fields: Record<string, unknown>): Cv => ({ text: null, value: null, column: { title }, ...fields })
const num = (title: string, n: number) => cv(title, { text: String(n), value: JSON.stringify(String(n)) })

function pokemonItem(id: string, name: string, over: { level?: number; gymId?: string | null } = {}) {
  const gymId = over.gymId === undefined ? 'g1' : over.gymId
  return {
    id,
    name,
    column_values: [
      num('Pokédex number', 4),
      cv('Types', { text: 'Fire', value: '{"ids":[2]}', values: [{ label: 'Fire' }] }),
      cv('Sprite', { text: `${name} - https://sprites.test/4.png`, value: JSON.stringify({ url: 'https://sprites.test/4.png', text: name }) }),
      num('HP', 39), num('Attack', 52), num('Defense', 43), num('Speed', 65),
      num('Level', over.level ?? 5), num('Energy', 2),
      cv('Status', { text: 'Ready', value: '{"index":7}', label: 'Ready' }),
      cv('Gym', gymId ? { linked_item_ids: [gymId], display_value: 'Cinnabar Gym' } : { linked_item_ids: [], display_value: '' }),
      cv('Gym type (mirror)', { display_value: gymId ? 'Fire' : '' }),
    ],
  }
}

function gymItem(id: string, name: string, pokemonIds: string[], levels: string) {
  return {
    id,
    name,
    column_values: [
      cv('Type', { text: 'Fire', values: [{ label: 'Fire' }] }),
      cv('Pokemon', { linked_item_ids: pokemonIds }),
      cv('Level (mirror)', { display_value: levels }),
    ],
  }
}

/** A GqlRequest that answers from a queue and records every call. */
function fakeRequest(...responses: unknown[]) {
  const calls: { query: string; variables?: Record<string, unknown> }[] = []
  const request: GqlRequest = async <T,>(query: string, variables?: Record<string, unknown>) => {
    calls.push({ query, variables })
    if (responses.length === 0) throw new Error(`unexpected request: ${query}`)
    return responses.shift() as T
  }
  return { request, calls }
}

describe('createBoardGateway — reads', () => {
  it('maps a Pokemon item by column title', async () => {
    const { request } = fakeRequest({ items: [pokemonItem('13', 'Charmander')] })
    const [p] = await createBoardGateway(request).getPokemonMany(['13'])
    expect(p).toEqual({
      id: '13', name: 'Charmander', dexNumber: 4, types: ['Fire'], spriteUrl: 'https://sprites.test/4.png',
      hp: 39, attack: 52, defense: 43, speed: 65, level: 5, energy: 2, status: 'Ready',
      gym: { id: 'g1', name: 'Cinnabar Gym', type: 'Fire' },
    })
  })

  it('getPokemonMany([]) makes no request', async () => {
    const { request, calls } = fakeRequest()
    expect(await createBoardGateway(request).getPokemonMany([])).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('names the missing column when a board lacks one', async () => {
    const item = pokemonItem('13', 'Charmander')
    item.column_values = item.column_values.filter((c) => c.column.title !== 'Energy')
    const { request } = fakeRequest({ items: [item] })
    await expect(createBoardGateway(request).getPokemonMany(['13'])).rejects.toThrow('Pokemon board: missing column "Energy"')
  })

  it('listGyms parses mirrored levels "5, 7" and keeps roster order', async () => {
    const { request, calls } = fakeRequest(
      { boards: [{ items_page: { cursor: null, items: [gymItem('g1', 'Cinnabar Gym', ['2', '1'], '5, 7')] } }] },
      { items: [pokemonItem('1', 'Charmander'), pokemonItem('2', 'Vulpix')] },
    )
    const [gym] = await createBoardGateway(request).listGyms({ boardIds: ['b-gyms'] })

    expect(calls[0].variables).toEqual({ boardIds: ['b-gyms'] })
    expect(gym.mirroredLevels).toEqual([5, 7])
    expect(gym.type).toBe('Fire')
    expect(gym.roster.map((p) => p.name)).toEqual(['Vulpix', 'Charmander'])
  })

  it('listPokemon filters by gym and status', async () => {
    const { request } = fakeRequest({
      boards: [{ items_page: { cursor: null, items: [pokemonItem('1', 'A'), pokemonItem('2', 'B', { gymId: null })] } }],
    })
    const list = await createBoardGateway(request).listPokemon({ boardIds: ['b-pokemon'], gymId: 'g1', status: 'Ready' })
    expect(list.map((p) => p.name)).toEqual(['A'])
  })
})

describe('createBoardGateway — writes', () => {
  const board = { id: 'b-pokemon', columns: [{ id: 'numeric_lvl', title: 'Level' }, { id: 'numeric_en', title: 'Energy' }, { id: 'color_st', title: 'Status' }] }

  it('updatePokemon resolves column ids by title then sends change_multiple_column_values once per item', async () => {
    const { request, calls } = fakeRequest({ items: [{ id: '1', board }, { id: '2', board }] }, {})
    await createBoardGateway(request).updatePokemon([
      { id: '1', patch: { level: 6, status: 'Ready' } },
      { id: '2', patch: { energy: 0 } },
    ])

    expect(calls).toHaveLength(2)
    expect(calls[1].query).toContain('w0: change_multiple_column_values')
    expect(calls[1].query).toContain('w1: change_multiple_column_values')
    expect(calls[1].variables).toMatchObject({
      board0: 'b-pokemon', item0: '1', values0: JSON.stringify({ numeric_lvl: '6', color_st: { label: 'Ready' } }),
      board1: 'b-pokemon', item1: '2', values1: JSON.stringify({ numeric_en: '0' }),
    })
  })

  it('updatePokemon validates every item before the first write', async () => {
    const { request, calls } = fakeRequest({ items: [{ id: '1', board }] })
    await expect(
      createBoardGateway(request).updatePokemon([{ id: '1', patch: { level: 2 } }, { id: '404', patch: { level: 2 } }]),
    ).rejects.toThrow('Item 404 not found')
    expect(calls).toHaveLength(1) // no mutation was sent
  })

  it('postUpdate returns the update id', async () => {
    const { request, calls } = fakeRequest({ create_update: { id: '99' } })
    expect(await createBoardGateway(request).postUpdate('g1', 'Cinnabar Gym wins')).toEqual({ updateId: '99' })
    expect(calls[0].variables).toEqual({ itemId: 'g1', body: 'Cinnabar Gym wins' })
  })

  it('runPrompt sends the v1 Talk config and returns the content', async () => {
    const { request, calls } = fakeRequest({ run_prompt: { content: 'Char, Charmander!' } })
    const reply = await createBoardGateway(request).runPrompt({ system: 'You ARE Charmander', user: 'Hi!' })
    expect(reply).toBe('Char, Charmander!')
    expect(calls[0].variables).toEqual({
      prompt: 'Hi!',
      config: { model: 'MONDAY_FAST', system_prompt: 'You ARE Charmander', temperature: 0.8, max_tokens: 60 },
    })
  })
})

describe('createBoardGateway — me', () => {
  it('me() maps id/name/account as strings', async () => {
    const { request } = fakeRequest({ me: { id: 101, name: 'Eden', account: { id: 202, name: 'Moveo' } } })
    expect(await createBoardGateway(request).me()).toEqual({ userId: '101', name: 'Eden', accountId: '202', accountName: 'Moveo' })
  })
})
