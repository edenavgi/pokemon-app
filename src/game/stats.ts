import type { Gym, Id, Pokemon, Status } from '../api/GameApi'

export interface GymStatRow { gymId: Id; name: string; count: number; avgLevel: number | null }
export interface GymStats { perGym: GymStatRow[]; perStatus: Record<Status, number> | null }

const NO_GYM_ID = 'none'
const NO_GYM_NAME = 'No gym'

function mean(levels: number[]): number | null {
  if (levels.length === 0) return null
  return levels.reduce((sum, l) => sum + l, 0) / levels.length
}

function rowsFromGyms(gyms: Gym[]): GymStatRow[] {
  return gyms.map((g) => ({ gymId: g.id, name: g.name, count: g.roster.length, avgLevel: mean(g.mirroredLevels) }))
}

function rowsFromPokemon(pokemon: Pokemon[]): GymStatRow[] {
  const groups = new Map<Id, { name: string; levels: number[] }>()
  const loose: number[] = []
  for (const p of pokemon) {
    if (!p.gym) {
      loose.push(p.level)
      continue
    }
    const group = groups.get(p.gym.id) ?? { name: p.gym.name, levels: [] }
    group.levels.push(p.level)
    groups.set(p.gym.id, group)
  }
  const rows = [...groups].map(([gymId, g]) => ({ gymId, name: g.name, count: g.levels.length, avgLevel: mean(g.levels) }))
  if (loose.length > 0) rows.push({ gymId: NO_GYM_ID, name: NO_GYM_NAME, count: loose.length, avgLevel: mean(loose) })
  return rows
}

function countStatuses(pokemon: Pokemon[]): Record<Status, number> {
  const counts: Record<Status, number> = { Recruited: 0, Training: 0, Ready: 0, Resting: 0 }
  for (const p of pokemon) counts[p.status]++
  return counts
}

export function gymStats(input: { gyms?: Gym[]; pokemon?: Pokemon[] }): GymStats {
  const { gyms, pokemon } = input
  const perGym = gyms ? rowsFromGyms(gyms) : pokemon ? rowsFromPokemon(pokemon) : []
  return { perGym, perStatus: pokemon ? countStatuses(pokemon) : null }
}
