import type { Pokemon, PokemonPatch, Status } from '../api/GameApi'
import { MAX_ENERGY, READY_LEVEL } from './constants'

export type SparError = 'NEED_TWO' | 'DUPLICATE' | 'NO_GYM' | 'DIFFERENT_GYMS' | 'NO_ENERGY' | 'RESTING'
export type SparValidation = { ok: true } | { ok: false; error: SparError; names?: string[] }

export function deriveStatus(p: Pick<Pokemon, 'level' | 'energy'>): Status {
  if (p.energy <= 0) return 'Resting'
  return p.level >= READY_LEVEL ? 'Ready' : 'Training'
}

export function validateSpar(ps: Pokemon[]): SparValidation {
  if (ps.length !== 2) return { ok: false, error: 'NEED_TWO' }
  const [a, b] = ps
  if (a.id === b.id) return { ok: false, error: 'DUPLICATE' }
  if (!a.gym || !b.gym) return { ok: false, error: 'NO_GYM' }
  if (a.gym.id !== b.gym.id) return { ok: false, error: 'DIFFERENT_GYMS' }
  const resting = ps.filter((p) => p.status === 'Resting')
  if (resting.length > 0) return { ok: false, error: 'RESTING', names: resting.map((p) => p.name) }
  const tired = ps.filter((p) => p.energy < 1)
  if (tired.length > 0) return { ok: false, error: 'NO_ENERGY', names: tired.map((p) => p.name) }
  return { ok: true }
}

export function applySpar(p: Pokemon): PokemonPatch {
  const level = p.level + 1
  const energy = Math.max(0, p.energy - 1)
  return { level, energy, status: deriveStatus({ level, energy }) }
}

export function applyRest(p: Pokemon): PokemonPatch {
  return { energy: MAX_ENERGY, status: deriveStatus({ level: p.level, energy: MAX_ENERGY }) }
}

export function allowedTransitions(p: Pokemon): { to: Status[]; canRest: boolean } {
  switch (p.status) {
    case 'Recruited':
      return { to: ['Training'], canRest: false }
    case 'Training':
      return { to: p.level >= READY_LEVEL ? ['Ready', 'Resting'] : ['Resting'], canRest: false }
    case 'Ready':
      return { to: ['Training', 'Resting'], canRest: false }
    case 'Resting':
      return { to: [], canRest: true }
  }
}
