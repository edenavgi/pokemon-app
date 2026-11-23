import type { Effectiveness, Gym, PokeType, Pokemon, TypeChart } from '../api/GameApi'
import { eligibleFighters } from './arena'
import { LUCK_MAX, LUCK_MIN } from './constants'
import type { Rng } from './rng'

export interface Round {
  index: number
  a: Pokemon
  b: Pokemon
  scoreA: number
  scoreB: number
  winner: 'A' | 'B' | 'draw'
}

export type BattleResult =
  | { ok: false; error: 'A_NOT_ELIGIBLE' | 'B_NOT_ELIGIBLE' | 'SAME_GYM' }
  | {
      ok: true
      rounds: Round[]
      winsA: number
      winsB: number
      totalA: number
      totalB: number
      winner: 'A' | 'B' | 'draw'
      decidedBy: 'rounds' | 'total' | 'draw'
    }

export function effectiveness(attacker: PokeType[], defender: PokeType[], chart: TypeChart): Effectiveness {
  if (defender.length === 0 || attacker.length === 0) return 1 // unknown types: neutral, not immune
  const target = defender[0]
  return attacker.reduce<Effectiveness>((best, t) => {
    const e = chart[t][target] ?? 1
    return e > best ? e : best
  }, 0)
}

export function roundScore(a: Pokemon, d: Pokemon, chart: TypeChart, r: number): number {
  const luck = LUCK_MIN + (LUCK_MAX - LUCK_MIN) * r
  return (a.attack + a.speed + a.hp) * (1 + a.level / 10) * effectiveness(a.types, d.types, chart) * luck
}

// Moved to the Arena engine (Phase 2); re-exported here until the v1 Arena is replaced (Task 8).
export { eligibleFighters }

export function battle(gymA: Gym, gymB: Gym, chart: TypeChart, rng: Rng): BattleResult {
  if (gymA.id === gymB.id) return { ok: false, error: 'SAME_GYM' }
  const fa = eligibleFighters(gymA)
  const fb = eligibleFighters(gymB)
  if (fa.length === 0) return { ok: false, error: 'A_NOT_ELIGIBLE' }
  if (fb.length === 0) return { ok: false, error: 'B_NOT_ELIGIBLE' }

  const rounds: Round[] = []
  let winsA = 0
  let winsB = 0
  let totalA = 0
  let totalB = 0
  const count = Math.min(fa.length, fb.length)
  for (let i = 0; i < count; i++) {
    const a = fa[i]
    const b = fb[i]
    const scoreA = roundScore(a, b, chart, rng())
    const scoreB = roundScore(b, a, chart, rng())
    const winner = scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'draw'
    if (winner === 'A') winsA++
    if (winner === 'B') winsB++
    totalA += scoreA
    totalB += scoreB
    rounds.push({ index: i + 1, a, b, scoreA, scoreB, winner })
  }

  let winner: 'A' | 'B' | 'draw'
  let decidedBy: 'rounds' | 'total' | 'draw'
  if (winsA !== winsB) {
    winner = winsA > winsB ? 'A' : 'B'
    decidedBy = 'rounds'
  } else if (totalA !== totalB) {
    winner = totalA > totalB ? 'A' : 'B'
    decidedBy = 'total'
  } else {
    winner = 'draw'
    decidedBy = 'draw'
  }
  return { ok: true, rounds, winsA, winsB, totalA, totalB, winner, decidedBy }
}

export function battleSummary(gymA: Gym, gymB: Gym, r: BattleResult & { ok: true }): string {
  const n = r.rounds.length
  const count = `${n} ${n === 1 ? 'round' : 'rounds'}`
  const verdict =
    r.winner === 'draw'
      ? `draw ${r.winsA}–${r.winsB}`
      : r.winner === 'A'
        ? `${gymA.name} wins ${r.winsA}–${r.winsB}`
        : `${gymB.name} wins ${r.winsB}–${r.winsA}`
  const head = `${gymA.name} vs ${gymB.name} — ${verdict} (${count})`
  const lines = r.rounds.map((x) => {
    const w = x.winner === 'A' ? x.a.name : x.winner === 'B' ? x.b.name : 'draw'
    return `Round ${x.index}: ${x.a.name} ${x.scoreA.toFixed(1)} vs ${x.b.name} ${x.scoreB.toFixed(1)} → ${w}`
  })
  return [head, ...lines].join('\n')
}
