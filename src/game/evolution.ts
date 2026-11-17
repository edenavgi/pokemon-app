import type { EvolutionInfo, EvolutionTarget, Pokemon, PokemonPatch, SpeciesDetail } from '../api/GameApi'
import { EVOLVE_LEVEL, GEN1_MAX_DEX } from './constants'

export type EvoBlock = 'MAX_STAGE' | 'NO_LEVEL_EVOLUTION' | 'BRANCHING' | 'OUTSIDE_GEN1' | 'LEVEL_TOO_LOW'
export type EvolutionCheck =
  | { eligible: true; target: EvolutionTarget }
  | { eligible: false; reason: EvoBlock; atLevel?: number }

export function evolutionCheck(p: Pokemon, evo: EvolutionInfo): EvolutionCheck {
  if (evo.stage === 3 || evo.next.length === 0) return { eligible: false, reason: 'MAX_STAGE' }
  if (evo.next.length > 1) return { eligible: false, reason: 'BRANCHING' }
  const target = evo.next[0]
  if (target.trigger === 'other') return { eligible: false, reason: 'NO_LEVEL_EVOLUTION' }
  if (target.dexNumber > GEN1_MAX_DEX) return { eligible: false, reason: 'OUTSIDE_GEN1' }
  const atLevel = EVOLVE_LEVEL[evo.stage]
  if (p.level < atLevel) return { eligible: false, reason: 'LEVEL_TOO_LOW', atLevel }
  return { eligible: true, target }
}

export function applyEvolution(species: SpeciesDetail): PokemonPatch {
  return {
    name: species.name,
    dexNumber: species.dexNumber,
    types: [...species.types],
    spriteUrl: species.spriteUrl,
    hp: species.hp,
    attack: species.attack,
    defense: species.defense,
    speed: species.speed,
  }
}

export function evolutionMessage(from: string, to: string): string {
  return `${from} evolved into ${to}`
}
