// MondayGameApi: the app's GameApi inside the monday iframe.
// This file holds only what is specific to the iframe:
//   - the monday SDK (context, listen, storage, notice, closing the feature window)
//   - SeamlessApiClient as the transport for the shared board gateway (src/api/boards/)
//   - memory + global SDK storage as the cache for the shared PokéAPI loaders (src/api/pokeapi/)
// Every query, column mapping and PokéAPI rule lives in those shared modules, so the server
// (Phase 2) runs exactly the same code with a user's token instead.
import mondaySdk from 'monday-sdk-js'
import { SeamlessApiClient } from '@mondaydotcomorg/api'
import type { AppContext, BoardConfig, GameApi, ThemeName } from '../GameApi'
import { createBoardGateway, type GqlRequest } from '../boards/gateway'
import { CACHE_KEYS, createPokeApi, fetchPokeApi, memoryPokeCache, type PokeCache } from '../pokeapi/loaders'

const monday = mondaySdk()

const client = new SeamlessApiClient('2026-10')

// SeamlessApiClient resolves to an envelope { method, requestId, data: { data, extensions } } (verify-early §3)
const seamlessRequest: GqlRequest = async <T,>(query: string, variables?: Record<string, unknown>) => {
  const res = await client.request<{ data: { data: T } }>(query, variables)
  return res.data.data
}

const boards = createBoardGateway(seamlessRequest)

// Global SDK storage key (shared by every widget/view of the app in this account)
const BOARD_CONFIG_KEY = 'boardConfig'

// PokéAPI cache: memory for this page load, plus global SDK storage for the two results that
// cost 18 requests (type chart, Gen-1 list), so later visits make none.
// Storage problems never break the screen: the shared loaders treat them as a cache miss.
const PERSISTED_KEYS = new Set<string>([CACHE_KEYS.typeChart, CACHE_KEYS.gen1])

function appPokeCache(): PokeCache {
  const memory = memoryPokeCache()
  return {
    async get<T>(key: string) {
      const hit = await memory.get<T>(key)
      if (hit !== undefined || !PERSISTED_KEYS.has(key)) return hit
      const raw = (await monday.storage.getItem(key)).data?.value
      if (!raw) return undefined
      const value = JSON.parse(raw) as T
      await memory.set(key, value, 0)
      return value
    },
    async set(key, value, ttlSeconds) {
      await memory.set(key, value, ttlSeconds)
      if (PERSISTED_KEYS.has(key)) await monday.storage.setItem(key, JSON.stringify(value))
    },
  }
}

const pokeApi = createPokeApi(fetchPokeApi, appPokeCache())

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toAppContext(data: any): AppContext {
  return {
    theme: data.theme as ThemeName,
    boardId: data.boardId != null ? String(data.boardId) : undefined,
    itemId: data.itemId != null ? String(data.itemId) : undefined,
    columnId: data.columnId != null ? String(data.columnId) : undefined,
    selectedItemIds: data.selectedPulsesIds?.map(String),
    widgetBoardIds: data.boardIds?.map(String),
  }
}

export function createMondayGameApi(): GameApi {
  async function requireBoardConfig(): Promise<BoardConfig> {
    const cfg = await api.getBoardConfig()
    if (!cfg) throw new Error('Choose the Gyms and Pokémon boards first')
    return cfg
  }

  const api: GameApi = {
    async getContext(): Promise<AppContext> {
      const res = await monday.get('context')
      return toAppContext(res.data)
    },
    onContextChange: (cb) =>
      monday.listen('context', (res) => cb(toAppContext(res.data))),
    onItemChanged: (itemId, cb) =>
      monday.listen('events', (res) => {
        const { itemIds } = res.data as { itemIds?: number[] }
        if (itemIds?.map(String).includes(itemId)) cb()
      }),

    listBoards: () => boards.listBoards(),
    getBoardConfig: async () => {
      const res = await monday.storage.getItem(BOARD_CONFIG_KEY)
      const raw = res.data?.value
      if (!raw) return null // never saved
      try {
        return JSON.parse(raw) as BoardConfig
      } catch {
        return null // corrupt value → ask the user again
      }
    },
    setBoardConfig: async (cfg) => {
      const res = await monday.storage.setItem(BOARD_CONFIG_KEY, JSON.stringify(cfg))
      if ((res.data as { success?: boolean } | undefined)?.success === false) {
        throw new Error('Could not save the board settings')
      }
    },

    getPokemon: async (itemId) => {
      const [pokemon] = await boards.getPokemonMany([itemId])
      if (!pokemon) throw new Error(`Pokémon item ${itemId} not found`)
      return pokemon
    },
    getPokemonMany: (itemIds) => boards.getPokemonMany(itemIds),
    listPokemon: (opts) => boards.listPokemon(opts),
    listGyms: (opts) => boards.listGyms(opts),
    getGym: (gymId) => boards.getGym(gymId),
    // New items go on the boards from the saved config
    createGym: async (input) => boards.createGym((await requireBoardConfig()).gymsBoardId, input),
    recruit: async (input) => boards.recruit((await requireBoardConfig()).pokemonBoardId, input),
    updatePokemon: (patches) => boards.updatePokemon(patches),
    setGym: (pokemonIds, gymId) => boards.setGym(pokemonIds, gymId),
    postUpdate: async (itemId, body) => {
      await boards.postUpdate(itemId, body)
    },

    // A toast inside monday (green / red / blue). Fire-and-forget: the contract returns void.
    notify: (message, type) => {
      monday
        .execute('notice', { message, type, timeout: 5000 })
        .catch((e: unknown) => console.warn('[notify] monday notice failed', e))
    },
    // Closes the window monday opened for this feature (e.g. "Transfer to gym").
    closeFeature: () => {
      monday
        .execute('closeAppFeatureModal')
        .catch((e: unknown) => console.warn('[closeFeature] could not close the feature window', e))
    },

    listGen1: () => pokeApi.listGen1(),
    getSpecies: (dexNumber) => pokeApi.getSpecies(dexNumber),
    getEvolution: (dexNumber) => pokeApi.getEvolution(dexNumber),
    getTypeChart: () => pokeApi.getTypeChart(),

    talk: async (prompt) => {
      try {
        return await boards.runPrompt(prompt)
      } catch (e) {
        console.warn('[talk] run_prompt failed', (e as { response?: unknown }).response ?? e)
        throw e
      }
    },
  }
  return api
}
