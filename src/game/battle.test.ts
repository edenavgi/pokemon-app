import { describe, expect, it } from 'vitest'
import type { Gym, Pokemon, TypeChart } from '../api/GameApi'
import { TYPE_CHART } from '../api/mock/fixtures'
import { battle, battleSummary, eligibleFighters, effectiveness, roundScore } from './battle'
import { mulberry32 } from './rng'
import { makeGym, makePokemon } from './testUtils'

const chart: TypeChart = {
  ...TYPE_CHART,
  Fire: { Grass: 2 },
  Grass: { ...TYPE_CHART.Grass, Fire: 0.5 },
  Electric: { Ground: 0 },
}
const half = () => 0.5

const charmander = makePokemon({ id: 'c', name: 'Charmander', level: 5, hp: 39, attack: 52, speed: 65 })
const bulbasaur = makePokemon({ id: 'b', name: 'Bulbasaur', types: ['Grass'], level: 5, hp: 45, attack: 49, speed: 45 })

// Score is exactly `hp` when attack, speed and level are 0 and luck is 1.0.
const flat = (id: string, hp: number, over: Partial<Pokemon> = {}): Pokemon =>
  makePokemon({ id, name: id, types: ['Normal'], hp, attack: 0, speed: 0, level: 0, status: 'Ready', energy: 3, ...over })
const gym = (id: string, name: string, roster: Pokemon[]): Gym => makeGym({ id, name, roster })

describe('mulberry32', () => {
  it('is deterministic and within [0,1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const seqA = [a(), a(), a(), a()]
    expect(seqA).toEqual([b(), b(), b(), b()])
    for (const n of seqA) {
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(1)
    }
  })
})

describe('effectiveness', () => {
  it('uses only the defender primary type', () => {
    expect(effectiveness(['Electric'], ['Ground', 'Flying'], chart)).toBe(0)
  })
  it('takes the attacker best type', () => {
    expect(effectiveness(['Grass', 'Poison'], ['Water'], chart)).toBe(2)
  })
  it('is 1 for an empty defender', () => {
    expect(effectiveness(['Fire'], [], chart)).toBe(1)
  })
  it('is 1 for an attacker without types (e.g. an empty Types cell)', () => {
    expect(effectiveness([], ['Water'], chart)).toBe(1)
  })
})

describe('roundScore', () => {
  it('matches the reference values at luck 1.0', () => {
    expect(roundScore(charmander, bulbasaur, chart, 0.5)).toBeCloseTo(468, 6)
    expect(roundScore(bulbasaur, charmander, chart, 0.5)).toBeCloseTo(104.25, 6)
  })
})

describe('eligibleFighters', () => {
  it('keeps roster order, Ready with energy, max 6', () => {
    const roster = [
      flat('a', 1), flat('b', 1, { status: 'Resting' }), flat('c', 1, { energy: 0 }),
      flat('d', 1), flat('e', 1), flat('f', 1), flat('g', 1), flat('h', 1), flat('i', 1),
    ]
    expect(eligibleFighters(gym('g', 'G', roster)).map((p) => p.id)).toEqual(['a', 'd', 'e', 'f', 'g', 'h'])
  })
})

describe('battle', () => {
  it('fights min(eligible) rounds, 1-based', () => {
    const a = gym('a', 'A', [flat('a1', 5), flat('a2', 5), flat('a3', 5)])
    const b = gym('b', 'B', [flat('b1', 1), flat('b2', 1)])
    const res = battle(a, b, chart, half)
    expect(res.ok && res.rounds.map((r) => r.index)).toEqual([1, 2])
  })

  it('decides by rounds', () => {
    const a = gym('a', 'A', [flat('a1', 9), flat('a2', 9)])
    const b = gym('b', 'B', [flat('b1', 1), flat('b2', 20)])
    const res = battle(a, b, chart, half)
    expect(res).toMatchObject({ ok: true, winsA: 1, winsB: 1, winner: 'B', decidedBy: 'total' })
    const a2 = gym('a', 'A', [flat('a1', 9), flat('a2', 9)])
    const b2 = gym('b', 'B', [flat('b1', 1), flat('b2', 1)])
    expect(battle(a2, b2, chart, half)).toMatchObject({ ok: true, winsA: 2, winner: 'A', decidedBy: 'rounds' })
  })

  it('1-1 in wins is decided by total', () => {
    const a = gym('a', 'A', [flat('a1', 10), flat('a2', 1)])
    const b = gym('b', 'B', [flat('b1', 5), flat('b2', 20)])
    const res = battle(a, b, chart, half)
    expect(res).toMatchObject({ ok: true, winsA: 1, winsB: 1, totalA: 11, totalB: 25, winner: 'B', decidedBy: 'total' })
  })

  it('fully drawn battle is a draw', () => {
    const a = gym('a', 'A', [flat('a1', 7), flat('a2', 7)])
    const b = gym('b', 'B', [flat('b1', 7), flat('b2', 7)])
    const res = battle(a, b, chart, half)
    expect(res).toMatchObject({ ok: true, winsA: 0, winsB: 0, winner: 'draw', decidedBy: 'draw' })
    expect(res.ok && res.rounds.every((r) => r.winner === 'draw')).toBe(true)
  })

  it('draw rounds still count toward totals', () => {
    const a = gym('a', 'A', [flat('a1', 7), flat('a2', 9)])
    const b = gym('b', 'B', [flat('b1', 7), flat('b2', 9)])
    const res = battle(a, b, chart, half)
    expect(res).toMatchObject({ ok: true, totalA: 16, totalB: 16, winner: 'draw' })
  })

  it('reports errors, SAME_GYM first', () => {
    const resting = gym('a', 'A', [flat('a1', 1, { status: 'Resting' })])
    const ok = gym('b', 'B', [flat('b1', 1)])
    expect(battle(resting, ok, chart, half)).toEqual({ ok: false, error: 'A_NOT_ELIGIBLE' })
    expect(battle(ok, resting, chart, half)).toEqual({ ok: false, error: 'B_NOT_ELIGIBLE' })
    expect(battle(resting, resting, chart, half)).toEqual({ ok: false, error: 'SAME_GYM' })
  })

  it('calls rng A then B per round and is deterministic with a seed', () => {
    const a = gym('a', 'A', [flat('a1', 10)])
    const b = gym('b', 'B', [flat('b1', 10)])
    const seq = [0, 1]
    let i = 0
    const res = battle(a, b, chart, () => seq[i++])
    expect(res.ok && res.rounds[0].scoreA).toBeCloseTo(8, 6)
    expect(res.ok && res.rounds[0].scoreB).toBeCloseTo(12, 6)
    const f1 = battle(a, b, chart, mulberry32(42))
    const f2 = battle(a, b, chart, mulberry32(42))
    expect(f1).toEqual(f2)
  })
})

describe('battleSummary', () => {
  it('is plain text with names, winner and round count', () => {
    const a = gym('a', 'Cinnabar Gym', [flat('Charmander', 20), flat('Vulpix', 20), flat('Growlithe', 1)])
    const b = gym('b', 'Cerulean Gym', [flat('Squirtle', 5), flat('Psyduck', 5), flat('Staryu', 9)])
    const res = battle(a, b, chart, half)
    if (!res.ok) throw new Error('expected ok')
    const text = battleSummary(a, b, res)
    const lines = text.split('\n')
    expect(lines[0]).toBe('Cinnabar Gym vs Cerulean Gym — Cinnabar Gym wins 2–1 (3 rounds)')
    expect(lines[1]).toBe('Round 1: Charmander 20.0 vs Squirtle 5.0 → Charmander')
    expect(lines).toHaveLength(4)
  })
  it('says draw', () => {
    const a = gym('a', 'A Gym', [flat('x', 5)])
    const b = gym('b', 'B Gym', [flat('y', 5)])
    const res = battle(a, b, chart, half)
    if (!res.ok) throw new Error('expected ok')
    const text = battleSummary(a, b, res)
    expect(text).toContain('draw')
    expect(text).toContain('(1 round)')
  })
})
