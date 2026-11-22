// Everything the game reads from and writes to the monday boards, in one place.
// It doesn't know HOW a request is sent: the caller passes a GqlRequest.
//   - the app (iframe): SeamlessApiClient, runs as the signed-in user (src/api/monday/index.ts)
//   - the server: ApiClient with the user's OAuth token (server/, Phase 2)
// So both run exactly the same queries and the same column mapping.
import { MAX_ENERGY, START_LEVEL } from '../../game/constants'
import type { Gym, Id, PokeType, Pokemon, PokemonPatch, SpeciesDetail, Status } from '../GameApi'
import {
  columnIdsFrom, patchToColumnValues, rosterIds, toGym, toPokemon,
  type BoardItem, type ColumnIdOf,
} from './mapping'
import {
  BOARDS_QUERY, BOARD_COLUMNS_QUERY, CREATE_UPDATE_MUTATION, GYMS_QUERY, GYM_QUERY, ITEM_BOARDS_QUERY,
  ME_QUERY, POKEMON_BOARD_QUERY, POKEMON_FIELDS, POKEMON_QUERY, RUN_PROMPT_MUTATION, createItemMutation,
} from './queries'

/** Sends one GraphQL request and resolves to its `data` object. Each caller unwraps its own envelope. */
export type GqlRequest = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>

/** The run_prompt settings of the v1 Talk feature. */
const TALK_CONFIG = { model: 'MONDAY_FAST', temperature: 0.8, max_tokens: 60 } as const

const MAX_ITEMS_PER_REQUEST = 100
const MAX_ITEMS_PER_PAGE = 500

export type BoardGateway = ReturnType<typeof createBoardGateway>

export function createBoardGateway(request: GqlRequest) {
  async function fetchPokemon(itemIds: Id[]): Promise<Pokemon[]> {
    if (itemIds.length === 0) return [] // nothing to ask for
    if (itemIds.length > MAX_ITEMS_PER_REQUEST) {
      console.warn(`[fetchPokemon] ${itemIds.length} ids; only the first ${MAX_ITEMS_PER_REQUEST} are fetched`)
    }
    const data = await request<{ items: BoardItem[] }>(POKEMON_QUERY, { itemIds })
    return data.items.map(toPokemon)
  }

  // All items of the given boards from a boards → items_page query (one page of up to 500 per board)
  async function fetchBoardItems(query: string, boardIds: Id[] | undefined, label: string): Promise<BoardItem[]> {
    const data = await request<{ boards: { items_page: { cursor: string | null; items: BoardItem[] } }[] }>(query, { boardIds })
    const pages = data.boards.map((b) => b.items_page)
    if (pages.some((p) => p.cursor)) {
      console.warn(`[${label}] a board has more than ${MAX_ITEMS_PER_PAGE} items; only the first ${MAX_ITEMS_PER_PAGE} are used`)
    }
    return pages.flatMap((p) => p.items)
  }

  // col("Type") → that column's ID on the board, or a clear error if the board lacks it
  async function columnIdsOf(boardId: Id, board: string): Promise<ColumnIdOf> {
    const data = await request<{ boards: { columns: { id: string; title: string }[] }[] }>(BOARD_COLUMNS_QUERY, { boardId })
    const columns = data.boards[0]?.columns
    if (!columns) throw new Error(`${board} board ${boardId} not found`)
    return columnIdsFrom(columns, board)
  }

  // Creates one item with its column values ({ columnId: value }) in ONE request
  async function createItem<T>(boardId: Id, name: string, values: Record<string, unknown>, fields: string): Promise<T> {
    const data = await request<{ create_item: T }>(createItemMutation(fields), {
      boardId, name, values: JSON.stringify(values), // column_values is a JSON *string*
    })
    return data.create_item
  }

  // Writes column values to many items in ONE request: one aliased change_multiple_column_values per item.
  // `build(itemId, col)` returns { columnId: value } for that item; col("Level") gives the column's ID.
  async function writeItems(itemIds: Id[], build: (itemId: Id, col: ColumnIdOf) => Record<string, unknown>): Promise<void> {
    if (itemIds.length === 0) return
    if (itemIds.length > MAX_ITEMS_PER_REQUEST) throw new Error(`Cannot update more than ${MAX_ITEMS_PER_REQUEST} items at once`)

    const data = await request<{ items: { id: string; board: { id: string; columns: { id: string; title: string }[] } }[] }>(
      ITEM_BOARDS_QUERY, { itemIds },
    )
    const itemById = new Map(data.items.map((i) => [i.id, i]))

    // Validate everything (items exist, columns exist) BEFORE the first write
    const writes = itemIds.map((itemId) => {
      const item = itemById.get(itemId)
      if (!item) throw new Error(`Item ${itemId} not found`)
      return { boardId: item.board.id, itemId, values: build(itemId, columnIdsFrom(item.board.columns, 'Pokemon')) }
    })

    // mutation ($board0: ID!, $item0: ID!, $values0: JSON!, $board1: …) { w0: change_…(…) { id } w1: … }
    const declarations = writes.map((_, i) => `$board${i}: ID!, $item${i}: ID!, $values${i}: JSON!`).join(', ')
    const fields = writes
      .map((_, i) => `w${i}: change_multiple_column_values(board_id: $board${i}, item_id: $item${i}, column_values: $values${i}) { id }`)
      .join('\n    ')
    const variables = Object.fromEntries(
      writes.flatMap((w, i) => [
        [`board${i}`, w.boardId],
        [`item${i}`, w.itemId],
        [`values${i}`, JSON.stringify(w.values)], // column_values is a JSON *string*
      ]),
    )
    await request(`mutation (${declarations}) {\n    ${fields}\n  }`, variables)
  }

  return {
    /** Boards the user can pick in BoardSetup (real boards only, most recently used first). */
    async listBoards(): Promise<{ id: Id; name: string }[]> {
      const data = await request<{ boards: { id: string; name: string; type: string }[] }>(BOARDS_QUERY)
      if (data.boards.length === 100) console.warn('[listBoards] showing only the 100 most recently used boards')
      // skip docs, subitem boards and custom objects
      return data.boards.filter((b) => b.type === 'board').map(({ id, name }) => ({ id, name }))
    },

    getPokemonMany: fetchPokemon,

    async listPokemon(opts: { boardIds?: Id[]; gymId?: Id; status?: Status } = {}): Promise<Pokemon[]> {
      const items = await fetchBoardItems(POKEMON_BOARD_QUERY, opts.boardIds, 'listPokemon')
      return items
        .map(toPokemon)
        .filter((p) => (!opts.gymId || p.gym?.id === opts.gymId) && (!opts.status || p.status === opts.status))
    },

    async listGyms(opts: { boardIds?: Id[] } = {}): Promise<Gym[]> {
      const gymItems = await fetchBoardItems(GYMS_QUERY, opts.boardIds, 'listGyms')
      // ONE query for every Pokémon of every gym
      const allIds = [...new Set(gymItems.flatMap(rosterIds))]
      const pokemonById = new Map((await fetchPokemon(allIds)).map((p) => [p.id, p]))
      return gymItems.map((g) => toGym(g, pokemonById))
    },

    // One gym and its roster: the gym item, then ONE query for its Pokémon (same shape as listGyms)
    async getGym(gymId: Id): Promise<Gym> {
      const data = await request<{ items: BoardItem[] }>(GYM_QUERY, { gymId })
      const gym = data.items[0]
      if (!gym) throw new Error(`Gym item ${gymId} not found`)
      const pokemonById = new Map((await fetchPokemon(rosterIds(gym))).map((p) => [p.id, p]))
      return toGym(gym, pokemonById)
    },

    // A new item on the Gyms board. Type is a dropdown: written by label.
    async createGym(gymsBoardId: Id, input: { name: string; type: PokeType }): Promise<Gym> {
      const col = await columnIdsOf(gymsBoardId, 'Gyms')
      const item = await createItem<{ id: string; name: string }>(gymsBoardId, input.name, { [col('Type')]: { labels: [input.type] } }, 'id name')
      return { id: item.id, name: item.name, type: input.type, roster: [], mirroredLevels: [] } // a new gym has no Pokémon yet
    },

    // A new item on the Pokémon board: species stats + starting level/energy/status + the link to its gym,
    // all in ONE create_item, read back in the same request (POKEMON_FIELDS → toPokemon).
    async recruit(pokemonBoardId: Id, input: { species: SpeciesDetail; gymId: Id }): Promise<Pokemon> {
      const { species, gymId } = input
      const col = await columnIdsOf(pokemonBoardId, 'Pokemon')
      const { name: _itemName, ...values } = patchToColumnValues( // the name goes in item_name
        {
          name: species.name, dexNumber: species.dexNumber, types: species.types, spriteUrl: species.spriteUrl,
          hp: species.hp, attack: species.attack, defense: species.defense, speed: species.speed,
          level: START_LEVEL, energy: MAX_ENERGY, status: 'Recruited',
        },
        col,
      )
      values[col('Gym')] = { item_ids: [Number(gymId)] } // connect boards: same format as setGym
      return toPokemon(await createItem<BoardItem>(pokemonBoardId, species.name, values, POKEMON_FIELDS))
    },

    async updatePokemon(patches: { id: Id; patch: PokemonPatch }[]): Promise<void> {
      const patchById = new Map(patches.map((p) => [p.id, p.patch]))
      await writeItems([...patchById.keys()], (itemId, col) => patchToColumnValues(patchById.get(itemId)!, col))
    },

    // The Gym connect column: { item_ids: [gymId] }. Two-way connect updates the Gyms board by itself.
    setGym(pokemonIds: Id[], gymId: Id): Promise<void> {
      return writeItems([...new Set(pokemonIds)], (_, col) => ({ [col('Gym')]: { item_ids: [Number(gymId)] } }))
    },

    async postUpdate(itemId: Id, body: string): Promise<{ updateId: Id }> {
      const data = await request<{ create_update: { id: string } }>(CREATE_UPDATE_MUTATION, { itemId, body })
      return { updateId: String(data.create_update.id) }
    },

    /** monday AI with the v1 Talk settings. */
    async runPrompt(p: { system: string; user: string }): Promise<string> {
      const data = await request<{ run_prompt: { content: string } }>(RUN_PROMPT_MUTATION, {
        prompt: p.user,
        config: { model: TALK_CONFIG.model, system_prompt: p.system, temperature: TALK_CONFIG.temperature, max_tokens: TALK_CONFIG.max_tokens },
      })
      return data.run_prompt.content
    },

    /** The user (and account) the request runs as. */
    async me(): Promise<{ userId: Id; name: string; accountId: Id; accountName: string }> {
      const data = await request<{ me: { id: string | number; name: string; account: { id: string | number; name: string } } }>(ME_QUERY)
      return { userId: String(data.me.id), name: data.me.name, accountId: String(data.me.account.id), accountName: data.me.account.name }
    },
  }
}
