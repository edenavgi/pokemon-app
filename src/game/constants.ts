import type { Move } from '../api/GameApi'

export const MAX_ROSTER = 6
export const MAX_ENERGY = 3
export const READY_LEVEL = 5
export const EVOLVE_LEVEL = { 1: 3, 2: 6 } as const
export const LUCK_MIN = 0.8
export const LUCK_MAX = 1.2
export const START_LEVEL = 1
export const GEN1_MAX_DEX = 151

// Arena (Phase 2): turn-by-turn battles on the server
/** Safety cap: a battle never runs longer than this many turns. */
export const MAX_TURNS = 300
/** The random factor in every hit: 0.85–1.0 (Phase 2 spec). */
export const DAMAGE_RANDOM_MIN = 0.85
export const DAMAGE_RANDOM_MAX = 1.0
/** Battle HP = base HP + 2 × level. */
export const HP_PER_LEVEL = 2
/** Used when no move can hurt the defender (or there are no moves): typeless, so never 0×. */
export const STRUGGLE: Move = { name: 'Struggle', type: null, power: 50 }
