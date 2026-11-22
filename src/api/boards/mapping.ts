// Board items ↔ game types. Columns are found by TITLE, never by ID (IDs are random per
// account and change when a column is recreated, verify-early §4).
import type { Gym, PokeType, Pokemon, PokemonPatch, Status } from '../GameApi'

// The shape of one column value, as we saw it in the console
export interface ColumnValue {
  text: string | null
  value?: string | null
  column: { title: string }
  values?: { label: string }[] // dropdown (Types)
  label?: string // status
  linked_item_ids?: string[] // connect boards (Gym)
  display_value?: string // connect boards / mirror
}

export interface BoardItem {
  id: string
  name: string
  column_values: ColumnValue[]
}

/** col(title) → the ID of the column with that title (used when WRITING). */
export type ColumnIdOf = (title: string) => string

// Returns col(title): the column value with that title, or a clear error if the board lacks it
export function columnReader(columnValues: ColumnValue[], board: string) {
  const byTitle = new Map(columnValues.map((cv) => [cv.column.title, cv]))
  return (title: string): ColumnValue => {
    const cv = byTitle.get(title)
    if (!cv) throw new Error(`${board} board: missing column "${title}"`)
    return cv
  }
}

/** Builds a ColumnIdOf from a board's { id, title } list. */
export function columnIdsFrom(columns: { id: string; title: string }[], board: string): ColumnIdOf {
  const idByTitle = new Map(columns.map((c) => [c.title, c.id]))
  return (title) => {
    const id = idByTitle.get(title)
    if (!id) throw new Error(`${board} board: missing column "${title}"`)
    return id
  }
}

export function toPokemon(item: BoardItem): Pokemon {
  const col = columnReader(item.column_values, 'Pokemon')
  const num = (title: string) => Number(col(title).text) || 0

  const sprite = col('Sprite').value
  const gym = col('Gym')
  const gymId = gym.linked_item_ids?.[0]

  return {
    id: item.id,
    name: item.name,
    dexNumber: num('Pokédex number'),
    types: (col('Types').values ?? []).map((v) => v.label as PokeType),
    spriteUrl: sprite ? JSON.parse(sprite).url : '',
    hp: num('HP'),
    attack: num('Attack'),
    defense: num('Defense'),
    speed: num('Speed'),
    level: num('Level'),
    energy: num('Energy'),
    status: col('Status').label as Status,
    gym: gymId
      ? {
          id: gymId,
          name: gym.display_value ?? '',
          type: (col('Gym type (mirror)').display_value || null) as PokeType | null,
        }
      : null,
  }
}

// "5, 7" → [5, 7]; "" → []
export function parseMirroredNumbers(text?: string): number[] {
  if (!text) return []
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map(Number)
    .filter(Number.isFinite)
}

/** The Pokémon item IDs linked to a gym item, in roster (= battle) order. */
export const rosterIds = (gym: BoardItem): string[] =>
  columnReader(gym.column_values, 'Gyms')('Pokemon').linked_item_ids ?? []

export function toGym(item: BoardItem, pokemonById: Map<string, Pokemon>): Gym {
  const col = columnReader(item.column_values, 'Gyms')
  return {
    id: item.id,
    name: item.name,
    type: (col('Type').values?.[0]?.label ?? null) as PokeType | null,
    roster: rosterIds(item)
      .map((id) => pokemonById.get(id))
      .filter((p): p is Pokemon => p !== undefined),
    mirroredLevels: parseMirroredNumbers(col('Level (mirror)').display_value),
  }
}

// Number columns: patch field → column title
const NUMBER_COLUMNS = {
  dexNumber: 'Pokédex number', hp: 'HP', attack: 'Attack', defense: 'Defense',
  speed: 'Speed', level: 'Level', energy: 'Energy',
} as const

// A PokemonPatch → { columnId: value } in the format each column type expects when WRITING
export function patchToColumnValues(patch: PokemonPatch, col: ColumnIdOf): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const [field, title] of Object.entries(NUMBER_COLUMNS) as [keyof typeof NUMBER_COLUMNS, string][]) {
    const n = patch[field]
    if (n !== undefined) values[col(title)] = String(n) // numbers: "5"
  }
  if (patch.status !== undefined) values[col('Status')] = { label: patch.status } // status: by label, never index
  if (patch.types !== undefined) values[col('Types')] = { labels: patch.types } // dropdown: by labels
  if (patch.spriteUrl !== undefined) values[col('Sprite')] = { url: patch.spriteUrl, text: patch.name ?? 'sprite' } // link
  if (patch.name !== undefined) values.name = patch.name // the item name (used by evolution)
  return values
}
