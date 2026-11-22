export const POKE_TYPES = [
  'Normal', 'Fire', 'Water', 'Grass', 'Electric', 'Ice', 'Fighting', 'Poison', 'Ground',
  'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
] as const
export type PokeType = (typeof POKE_TYPES)[number]
export const STATUSES = ['Recruited', 'Training', 'Ready', 'Resting'] as const
export type Status = (typeof STATUSES)[number]
export type Id = string

export interface GymRef { id: Id; name: string; type: PokeType | null }
export interface Pokemon {
  id: Id; name: string; dexNumber: number; types: PokeType[]
  spriteUrl: string; hp: number; attack: number; defense: number; speed: number
  level: number; energy: number; status: Status; gym: GymRef | null
}
export interface Gym {
  id: Id; name: string; type: PokeType | null
  roster: Pokemon[]; mirroredLevels: number[] // roster order = battle order
}
export interface BoardConfig { gymsBoardId: Id; pokemonBoardId: Id }
export type ThemeName = 'light' | 'dark' | 'black'
export interface AppContext {
  theme: ThemeName; boardId?: Id; itemId?: Id; columnId?: Id
  selectedItemIds?: Id[]; widgetBoardIds?: Id[]
}
export interface SpeciesSummary { dexNumber: number; name: string; types: PokeType[]; spriteUrl: string }
export interface SpeciesDetail extends SpeciesSummary {
  hp: number; attack: number; defense: number; speed: number; flavorText: string
}
export interface EvolutionTarget {
  dexNumber: number; name: string; trigger: 'level-up' | 'other'; minLevel: number | null
}
export interface EvolutionInfo { stage: 1 | 2 | 3; next: EvolutionTarget[] }
/** A damaging move from PokéAPI, used by the server's battle engine. `type: null` = typeless (Struggle). */
export interface Move { name: string; type: PokeType | null; power: number }
export type Effectiveness = 0 | 0.5 | 1 | 2
export type TypeChart = Record<PokeType, Partial<Record<PokeType, Effectiveness>>> // missing = 1
export type PokemonPatch = Partial<Omit<Pokemon, 'id' | 'gym'>>
export type Unsubscribe = () => void
export type NoticeType = 'success' | 'error' | 'info'

export interface GameApi {
  listBoards(): Promise<{ id: Id; name: string }[]>
  getBoardConfig(): Promise<BoardConfig | null>
  setBoardConfig(cfg: BoardConfig): Promise<void>
  getContext(): Promise<AppContext>
  onContextChange(cb: (ctx: AppContext) => void): Unsubscribe
  onItemChanged(itemId: Id, cb: () => void): Unsubscribe
  getPokemon(itemId: Id): Promise<Pokemon>
  getPokemonMany(itemIds: Id[]): Promise<Pokemon[]>
  listPokemon(opts?: { boardIds?: Id[]; gymId?: Id; status?: Status }): Promise<Pokemon[]>
  listGyms(opts?: { boardIds?: Id[] }): Promise<Gym[]>
  getGym(gymId: Id): Promise<Gym>
  createGym(input: { name: string; type: PokeType }): Promise<Gym>
  recruit(input: { species: SpeciesDetail; gymId: Id }): Promise<Pokemon>
  updatePokemon(patches: { id: Id; patch: PokemonPatch }[]): Promise<void>
  setGym(pokemonIds: Id[], gymId: Id): Promise<void>
  postUpdate(itemId: Id, body: string): Promise<void>
  notify(message: string, type: NoticeType): void
  closeFeature(): void // closes modal/dialog of menu & column features
  listGen1(): Promise<SpeciesSummary[]>
  getSpecies(dexNumber: number): Promise<SpeciesDetail>
  getEvolution(dexNumber: number): Promise<EvolutionInfo>
  getTypeChart(): Promise<TypeChart>
  talk(prompt: { system: string; user: string }): Promise<string>
}
