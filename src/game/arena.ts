// The Arena engine (Phase 2): a turn-by-turn battle between two gyms.
// Pure: no HTTP, no Telegram, no monday — the server's queue handler and the Telegram bot
// both run it. Rules decided with Eden on 2026-11-23:
//   - Fighters: Ready with Energy ≥ 1, in roster order (max 6). They fight 1v1, in order;
//     the winner keeps its remaining HP and meets the next opponent.
//   - HP = base HP + 2 × level. The faster Pokémon attacks first (tie → side A); then they alternate.
//   - Each turn the attacker uses its strongest move: highest power × type effectiveness.
//   - Damage = Pokémon-style formula × effectiveness × random 0.85–1.0 (at least 1, or 0 if immune).
//   - If no move can hurt the defender, Struggle (typeless) — so every matchup ends.
// It is a generator: it yields each turn as it happens, so the caller can save turns
// DURING the battle, and returns the outcome at the end. Same teams + same seed = same battle.
import type { Gym, Id, Move, PokeType, Pokemon, TypeChart } from '../api/GameApi'
import {
  DAMAGE_RANDOM_MAX, DAMAGE_RANDOM_MIN, HP_PER_LEVEL, MAX_ROSTER, MAX_TURNS, STRUGGLE,
} from './constants'
import type { Rng } from './rng'

export interface ArenaFighter {
  id: Id
  name: string
  types: PokeType[]
  level: number
  hp: number
  attack: number
  defense: number
  speed: number
  moves: Move[]
}

export interface ArenaTeam {
  id: Id
  name: string
  fighters: ArenaFighter[]
}

/** One attack. These are what the server saves in battle_turns and the replay plays. */
export interface ArenaTurn {
  n: number // 1, 2, 3… across the whole battle
  matchup: number // which 1v1 pairing (1 = first fighters of each side)
  side: 'A' | 'B' // the attacker's side
  attackerId: Id
  attackerName: string
  defenderId: Id
  defenderName: string
  move: string
  moveType: PokeType | null
  effectiveness: number
  damage: number // HP actually removed
  defenderHpLeft: number
  defenderMaxHp: number
  fainted: boolean
}

export interface ArenaOutcome {
  winner: 'A' | 'B' | 'draw'
  endedBy: 'knockout' | 'turnLimit'
  turnCount: number
  fought: Id[] // every fighter that took part, in order of appearance (they lose Energy)
  mvp: { id: Id; name: string; kos: number; damage: number } | null
  survivorsA: number
  survivorsB: number
}

export type ArenaError = 'SAME_GYM' | 'A_NOT_ELIGIBLE' | 'B_NOT_ELIGIBLE'

/** The gym's fighters: Ready with Energy, in roster (= battle) order, max 6. */
export function eligibleFighters(g: Gym): Pokemon[] {
  return g.roster.filter((p) => p.status === 'Ready' && p.energy >= 1).slice(0, MAX_ROSTER)
}

/** Can these two gyms battle? Same error codes (and texts) as the v1 Arena. */
export function validateArena(gymA: Gym, gymB: Gym): { ok: true } | { ok: false; error: ArenaError } {
  if (gymA.id === gymB.id) return { ok: false, error: 'SAME_GYM' }
  if (eligibleFighters(gymA).length === 0) return { ok: false, error: 'A_NOT_ELIGIBLE' }
  if (eligibleFighters(gymB).length === 0) return { ok: false, error: 'B_NOT_ELIGIBLE' }
  return { ok: true }
}

/** A gym → its battle team. `movesets` is by Pokédex number; no moves → Struggle only. */
export function toArenaTeam(gym: Gym, movesets: Map<number, Move[]>): ArenaTeam {
  return {
    id: gym.id,
    name: gym.name,
    fighters: eligibleFighters(gym).map((p) => {
      const moves = movesets.get(p.dexNumber) ?? []
      return {
        id: p.id, name: p.name, types: [...p.types], level: p.level,
        hp: p.hp, attack: p.attack, defense: p.defense, speed: p.speed,
        moves: moves.length > 0 ? moves : [STRUGGLE],
      }
    }),
  }
}

/** The move's multiplier against ALL the defender's types (so 0, 0.25, 0.5, 1, 2 or 4). Typeless = 1. */
export function moveEffectiveness(moveType: PokeType | null, defender: PokeType[], chart: TypeChart): number {
  if (moveType === null) return 1
  return defender.reduce((product, t) => product * (chart[moveType]?.[t] ?? 1), 1)
}

/**
 * One hit. Pokémon-style: ((2·L/5 + 2) · power · Atk/Def / 50 + 2) · effectiveness · random,
 * with random = 0.85 + 0.15·r. At least 1 unless the defender is immune (effectiveness 0).
 */
export function damage(att: ArenaFighter, def: ArenaFighter, move: Move, eff: number, r: number): number {
  if (eff === 0) return 0
  const base = ((2 * att.level) / 5 + 2) * move.power * (att.attack / Math.max(1, def.defense)) / 50 + 2
  const random = DAMAGE_RANDOM_MIN + (DAMAGE_RANDOM_MAX - DAMAGE_RANDOM_MIN) * r
  return Math.max(1, Math.floor(base * eff * random))
}

const maxHp = (f: ArenaFighter) => f.hp + HP_PER_LEVEL * f.level

// The strongest move against this defender (power × effectiveness; a tie keeps the earlier move).
// If nothing can hurt it, Struggle.
function chooseMove(att: ArenaFighter, def: ArenaFighter, chart: TypeChart): { move: Move; eff: number } {
  let best: { move: Move; eff: number; score: number } | undefined
  for (const move of att.moves) {
    const eff = moveEffectiveness(move.type, def.types, chart)
    const score = move.power * eff
    if (!best || score > best.score) best = { move, eff, score }
  }
  if (!best || best.score === 0) return { move: STRUGGLE, eff: 1 }
  return best
}

export function* simulateArena(a: ArenaTeam, b: ArenaTeam, chart: TypeChart, rng: Rng): Generator<ArenaTurn, ArenaOutcome> {
  const hp = { A: a.fighters.map(maxHp), B: b.fighters.map(maxHp) }
  const index = { A: 0, B: 0 }
  const fighters = { A: a.fighters, B: b.fighters }
  const credit = new Map<Id, { name: string; kos: number; damage: number }>()
  const fought: Id[] = []
  let n = 0
  let matchup = 0
  let endedBy: ArenaOutcome['endedBy'] = 'knockout'

  battle: while (index.A < fighters.A.length && index.B < fighters.B.length) {
    matchup++
    const pair = { A: fighters.A[index.A], B: fighters.B[index.B] }
    for (const f of [pair.A, pair.B]) if (!fought.includes(f.id)) fought.push(f.id)
    let side: 'A' | 'B' = pair.B.speed > pair.A.speed ? 'B' : 'A'

    while (hp.A[index.A] > 0 && hp.B[index.B] > 0) {
      if (n >= MAX_TURNS) {
        endedBy = 'turnLimit'
        break battle
      }
      n++
      const other = side === 'A' ? 'B' : 'A'
      const att = pair[side]
      const def = pair[other]
      const { move, eff } = chooseMove(att, def, chart)
      const before = hp[other][index[other]]
      const left = Math.max(0, before - damage(att, def, move, eff, rng()))
      hp[other][index[other]] = left

      const c = credit.get(att.id) ?? { name: att.name, kos: 0, damage: 0 }
      c.damage += before - left
      if (left === 0) c.kos++
      credit.set(att.id, c)

      yield {
        n, matchup, side,
        attackerId: att.id, attackerName: att.name, defenderId: def.id, defenderName: def.name,
        move: move.name, moveType: move.type, effectiveness: eff,
        damage: before - left, defenderHpLeft: left, defenderMaxHp: maxHp(def), fainted: left === 0,
      }
      side = other
    }
    if (hp.A[index.A] === 0) index.A++
    if (hp.B[index.B] === 0) index.B++
  }

  // Fighters from `index` on are still standing (the ones before it fainted)
  const survivorsA = fighters.A.length - index.A
  const survivorsB = fighters.B.length - index.B
  const hpShare = (side: 'A' | 'B') => {
    const max = fighters[side].reduce((sum, f) => sum + maxHp(f), 0)
    return max === 0 ? 0 : hp[side].reduce((sum, h) => sum + h, 0) / max
  }
  let winner: ArenaOutcome['winner']
  if (survivorsA !== survivorsB) winner = survivorsA > survivorsB ? 'A' : 'B'
  else if (hpShare('A') !== hpShare('B')) winner = hpShare('A') > hpShare('B') ? 'A' : 'B'
  else winner = 'draw'

  let mvp: ArenaOutcome['mvp'] = null
  for (const [id, c] of credit) {
    if (!mvp || c.kos > mvp.kos || (c.kos === mvp.kos && c.damage > mvp.damage)) mvp = { id, ...c }
  }

  return { winner, endedBy, turnCount: n, fought, mvp, survivorsA, survivorsB }
}
