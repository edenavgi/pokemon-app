// MondayGameApi: the app's GameApi inside the monday iframe.
// This file holds only what is specific to the iframe:
//   - the monday SDK (context, listen, storage, notice, closing the feature window)
//   - SeamlessApiClient as the transport for the shared board gateway (src/api/boards/)
//   - memory + global SDK storage as the cache for the shared PokéAPI loaders (src/api/pokeapi/)
// Every query, column mapping and PokéAPI rule lives in those shared modules, so the server
// (Phase 2) runs exactly the same code with a user's token instead.
import mondaySdk from 'monday-sdk-js'
import { SeamlessApiClient } from '@mondaydotcomorg/api'
import type { AppContext, ArenaTurn, BattleView, BoardConfig, GameApi, ServerStatus, ThemeName } from '../GameApi'
import { createBoardGateway, type GqlRequest } from '../boards/gateway'
import { CACHE_KEYS, createPokeApi, fetchPokeApi, memoryPokeCache, type PokeCache } from '../pokeapi/loaders'
import { createServerClient } from '../server/serverClient'

const monday = mondaySdk()

const client = new SeamlessApiClient('2026-10')

// SeamlessApiClient resolves to an envelope { method, requestId, data: { data, extensions } } (verify-early §3)
const seamlessRequest: GqlRequest = async <T,>(query: string, variables?: Record<string, unknown>) => {
  const res = await client.request<{ data: { data: T } }>(query, variables)
  return res.data.data
}

const boards = createBoardGateway(seamlessRequest)

// Our server (Phase 2). VITE_SERVER_URL is set at build time (GitHub variable SERVER_URL);
// empty in local dev, where Vite proxies /api to the local server.
// Every call carries a fresh sessionToken: monday signs it, the server verifies it.
const server = createServerClient(import.meta.env.VITE_SERVER_URL ?? '', async () => {
  const res = await monday.get('sessionToken')
  return String(res.data)
})

// The server's battle document (BattleView in server/src/battle/service.ts) → the app's BattleView
type ServerBattle = Omit<BattleView, 'id'> & { _id: string }
const toBattle = ({ _id, ...rest }: ServerBattle): BattleView => ({ ...rest, id: _id })

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
      // Best effort: the server learns the boards too (works only after Connect; the Connect
      // tab syncs them again then). A failure here must not undo the saved setup.
      api.syncBoardConfig(cfg).catch((e: unknown) => console.warn('[syncBoardConfig] the server did not take the boards', e))
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

    getServerStatus: async (): Promise<ServerStatus> => {
      const me = await server.get<{ connected: boolean; boardsKnown: boolean; telegram: { linked: boolean } }>('/api/me')
      return { connected: me.connected, boardsKnown: me.boardsKnown, telegramLinked: me.telegram.linked }
    },
    // The server makes the state + PKCE pair and builds monday's consent URL; the app only opens it.
    // The OAuth token itself never comes back to the app.
    startMondayOAuth: async () => {
      const { authorizeUrl } = await server.post<{ authorizeUrl: string }>('/api/oauth/start')
      // Not awaited: monday opens the tab but never answers this request (seen 2026-11-22,
      // verify-early §16). Waiting for it left the Connect tab stuck before polling began.
      monday
        .execute('openLinkInTab', { url: authorizeUrl })
        .catch((e: unknown) => console.warn('[startMondayOAuth] could not open the consent tab', e))
    },
    syncBoardConfig: (cfg) => server.put('/api/me/boards', cfg),

    // The Arena runs on the server: it answers 202 at once and plays the battle from its queue
    startBattle: (gymAId, gymBId) => server.post<{ battleId: string }>('/api/battles', { gymAId, gymBId }),
    getBattle: async (battleId, opts) => {
      const res = await server.get<{ battle: ServerBattle; turns?: ArenaTurn[] }>(
        `/api/battles/${encodeURIComponent(battleId)}?turns=${opts.turns ? 1 : 0}`,
      )
      return { battle: toBattle(res.battle), ...(res.turns ? { turns: res.turns } : {}) }
    },
    listBattles: async (limit = 10) => {
      const res = await server.get<{ battles: ServerBattle[] }>(`/api/battles?limit=${limit}`)
      return res.battles.map(toBattle)
    },

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
