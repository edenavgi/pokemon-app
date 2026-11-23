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
  if (!a.gym || !b.gym) return { ok: false, error: 'NO_GYM', names: ps.filter((p) => !p.gym).map((p) => p.name) }
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
    default:
      // The cell holds a label the game doesn't know, or is empty (edited by hand in monday).
      // The dialog is the only way back, so offer Training and Rest instead of crashing.
      return { to: ['Training'], canRest: true }
  }
}

/**
 * After an Arena battle, every Pokémon that fought loses 1 Energy (the v1 cost of a spar).
 * At 0 it goes to Resting; otherwise its status stays.
 */
export function applyBattleFatigue(p: Pick<Pokemon, 'energy' | 'status'>): PokemonPatch {
  const energy = Math.max(0, p.energy - 1)
  return { energy, status: energy === 0 ? 'Resting' : p.status }
}

/**
 * The hourly cron: +1 Energy up to MAX_ENERGY. A Resting Pokémon that reaches full Energy
 * gets the v1 Rest status: Ready at level ≥ 5, otherwise Training (Eden's decision, 2026-11-23).
 * null = already full, nothing to write.
 */
export function applyRegen(p: Pokemon): PokemonPatch | null {
  if (p.energy >= MAX_ENERGY) return null
  const energy = p.energy + 1
  if (p.status === 'Resting' && energy === MAX_ENERGY) return { energy, status: deriveStatus({ level: p.level, energy }) }
  return { energy }
}
