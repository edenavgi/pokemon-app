import type {
  AppContext, BoardConfig, ServerStatus, EvolutionInfo, GameApi, Gym, Id, NoticeType, Pokemon, PokemonPatch,
  PokeType, SpeciesDetail, SpeciesSummary, Status, TypeChart, Unsubscribe,
} from '../GameApi'
import { EVOLUTIONS, SEED_GYMS, SEED_POKEMON, SPECIES, TYPE_CHART } from './fixtures'

interface PokemonRow {
  id: Id; name: string; dexNumber: number; types: PokeType[]; spriteUrl: string
  hp: number; attack: number; defense: number; speed: number
  level: number; energy: number; status: Status; gymId: Id | null
}
interface GymRow { id: Id; name: string; type: PokeType | null }

export interface MockOptions { context?: Partial<AppContext>; delayMs?: number; failTalk?: boolean }

export class MockGameApi implements GameApi {
  notices: { message: string; type: NoticeType }[] = []
  updates: { itemId: Id; body: string }[] = []
  /** The fake server's view of the user; tests change it to simulate OAuth finishing. */
  serverStatus: ServerStatus = { connected: false, boardsKnown: false, telegramLinked: false }
  oauthStarts = 0
  syncedBoards: BoardConfig[] = []

  private pokemon = new Map<Id, PokemonRow>()
  private gyms = new Map<Id, GymRow>()
  private nextPokemon = 1
  private nextGym = 1
  private boardConfig: BoardConfig | null = null
  private context: AppContext
  private contextListeners = new Set<(ctx: AppContext) => void>()
  private itemListeners = new Map<Id, Set<() => void>>()

  private opts: MockOptions

  constructor(opts: MockOptions = {}) {
    this.opts = opts
    this.context = { theme: 'light', ...opts.context }
    for (const g of SEED_GYMS) this.gyms.set(g.id, { ...g })
    for (const s of SEED_POKEMON) {
      const sp = this.species(s.dexNumber)
      this.pokemon.set(s.id, {
        id: s.id, name: sp.name, dexNumber: sp.dexNumber, types: [...sp.types], spriteUrl: sp.spriteUrl,
        hp: sp.hp, attack: sp.attack, defense: sp.defense, speed: sp.speed,
        level: s.level, energy: s.energy, status: s.status, gymId: s.gymId,
      })
    }
    this.nextPokemon = this.pokemon.size + 1
    this.nextGym = this.gyms.size + 1
  }

  // --- test helpers ---
  setContext(partial: Partial<AppContext>): void {
    this.context = { ...this.context, ...partial }
    for (const cb of [...this.contextListeners]) cb({ ...this.context })
  }

  // --- internals ---
  private async wait(): Promise<void> {
    if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs))
  }
  private species(dex: number): SpeciesDetail {
    const s = SPECIES.find((x) => x.dexNumber === dex)
    if (!s) throw new Error(`Unknown species ${dex}`)
    return s
  }
  private gymRef(id: Id | null) {
    if (!id) return null
    const g = this.gyms.get(id)
    return g ? { id: g.id, name: g.name, type: g.type } : null
  }
  private toPokemon(row: PokemonRow): Pokemon {
    const { gymId, types, ...rest } = row
    return { ...rest, types: [...types], gym: this.gymRef(gymId) }
  }
  private toGym(row: GymRow): Gym {
    const roster = [...this.pokemon.values()].filter((p) => p.gymId === row.id).map((p) => this.toPokemon(p))
    return { ...row, roster, mirroredLevels: roster.map((p) => p.level) }
  }
  private row(id: Id): PokemonRow {
    const r = this.pokemon.get(id)
    if (!r) throw new Error(`Pokemon ${id} not found`)
    return r
  }
  private fire(id: Id) {
    for (const cb of [...(this.itemListeners.get(id) ?? [])]) cb()
  }

  // --- GameApi ---
  async listBoards() {
    await this.wait()
    return [{ id: 'b1', name: 'Gyms' }, { id: 'b2', name: 'Pokémon' }]
  }
  async getServerStatus() { await this.wait(); return { ...this.serverStatus } }
  async startMondayOAuth() { await this.wait(); this.oauthStarts++ }
  async syncBoardConfig(cfg: BoardConfig) {
    await this.wait()
    if (!this.serverStatus.connected) throw new Error('Connect monday first')
    this.syncedBoards.push({ ...cfg })
    this.serverStatus.boardsKnown = true
  }
  async getBoardConfig() { await this.wait(); return this.boardConfig }
  async setBoardConfig(cfg: BoardConfig) { await this.wait(); this.boardConfig = cfg }
  async getContext() { await this.wait(); return { ...this.context } }
  onContextChange(cb: (ctx: AppContext) => void): Unsubscribe {
    this.contextListeners.add(cb)
    return () => { this.contextListeners.delete(cb) }
  }
  onItemChanged(itemId: Id, cb: () => void): Unsubscribe {
    let set = this.itemListeners.get(itemId)
    if (!set) this.itemListeners.set(itemId, (set = new Set()))
    set.add(cb)
    return () => { set.delete(cb) }
  }
  async getPokemon(itemId: Id) { await this.wait(); return this.toPokemon(this.row(itemId)) }
  async getPokemonMany(itemIds: Id[]) { await this.wait(); return itemIds.map((id) => this.toPokemon(this.row(id))) }
  async listPokemon(opts?: { boardIds?: Id[]; gymId?: Id; status?: Status }) {
    await this.wait()
    return [...this.pokemon.values()]
      .filter((p) => (!opts?.gymId || p.gymId === opts.gymId) && (!opts?.status || p.status === opts.status))
      .map((p) => this.toPokemon(p))
  }
  async listGyms(_opts?: { boardIds?: Id[] }) {
    await this.wait()
    return [...this.gyms.values()].map((g) => this.toGym(g))
  }
  async getGym(gymId: Id) {
    await this.wait()
    const g = this.gyms.get(gymId)
    if (!g) throw new Error(`Gym ${gymId} not found`)
    return this.toGym(g)
  }
  async createGym(input: { name: string; type: PokeType }) {
    await this.wait()
    const g: GymRow = { id: `g${this.nextGym++}`, name: input.name, type: input.type }
    this.gyms.set(g.id, g)
    return this.toGym(g)
  }
  async recruit(input: { species: SpeciesDetail; gymId: Id }) {
    await this.wait()
    if (!this.gyms.has(input.gymId)) throw new Error(`Gym ${input.gymId} not found`)
    const s = input.species
    const row: PokemonRow = {
      id: `p${this.nextPokemon++}`, name: s.name, dexNumber: s.dexNumber, types: [...s.types],
      spriteUrl: s.spriteUrl, hp: s.hp, attack: s.attack, defense: s.defense, speed: s.speed,
      level: 1, energy: 3, status: 'Recruited', gymId: input.gymId,
    }
    this.pokemon.set(row.id, row)
    return this.toPokemon(row)
  }
  async updatePokemon(patches: { id: Id; patch: PokemonPatch }[]) {
    await this.wait()
    for (const { id } of patches) this.row(id) // validate before mutating
    const touched = new Set<Id>()
    for (const { id, patch } of patches) {
      Object.assign(this.row(id), patch)
      touched.add(id)
    }
    for (const id of touched) this.fire(id)
  }
  async setGym(pokemonIds: Id[], gymId: Id) {
    await this.wait()
    if (!this.gyms.has(gymId)) throw new Error(`Gym ${gymId} not found`)
    for (const id of pokemonIds) this.row(id)
    for (const id of new Set(pokemonIds)) {
      this.row(id).gymId = gymId
      this.fire(id)
    }
  }
  async postUpdate(itemId: Id, body: string) { await this.wait(); this.updates.push({ itemId, body }) }
  notify(message: string, type: NoticeType) { this.notices.push({ message, type }) }
  closeFeature() {}
  // Returns only the fixture species, not all 151.
  async listGen1(): Promise<SpeciesSummary[]> {
    await this.wait()
    return SPECIES.map(({ dexNumber, name, types, spriteUrl }) => ({ dexNumber, name, types: [...types], spriteUrl }))
  }
  async getSpecies(dexNumber: number) { await this.wait(); return this.species(dexNumber) }
  async getEvolution(dexNumber: number): Promise<EvolutionInfo> {
    await this.wait()
    const e = EVOLUTIONS[dexNumber]
    if (!e) throw new Error(`No evolution info for ${dexNumber}`)
    return e
  }
  async getTypeChart(): Promise<TypeChart> { await this.wait(); return TYPE_CHART }
  async talk(_prompt: { system: string; user: string }) {
    await this.wait()
    if (this.opts.failTalk) throw new Error('run_prompt failed')
    return 'Great work out there, trainer! Keep training and stay hydrated.'
  }
}
