import { describe, expect, it } from 'vitest'
import type { Move, TypeChart } from '../api/GameApi'
import {
  damage, moveEffectiveness, simulateArena, toArenaTeam, validateArena,
  type ArenaFighter, type ArenaOutcome, type ArenaTeam, type ArenaTurn,
} from './arena'
import { MAX_TURNS, STRUGGLE } from './constants'
import { mulberry32, type Rng } from './rng'
import { makeGym, makePokemon } from './testUtils'

// Only the matchups these tests use; a missing entry means ×1
const chart = {
  Fire: { Grass: 2 },
  Grass: { Fire: 0.5, Grass: 0.5 },
  Ice: { Grass: 2, Flying: 2 },
  Normal: { Ghost: 0 },
  Ghost: { Normal: 0 },
} as unknown as TypeChart

const move = (name: string, type: Move['type'], power: number): Move => ({ name, type, power })
const EMBER = move('Ember', 'Fire', 40)
const SCRATCH = move('Scratch', 'Normal', 40)
const TACKLE = move('Tackle', 'Normal', 40)
const VINE_WHIP = move('Vine Whip', 'Grass', 45)

const fighter = (over: Partial<ArenaFighter> & Pick<ArenaFighter, 'id'>): ArenaFighter => ({
  name: over.id, types: ['Normal'], level: 5, hp: 40, attack: 50, defense: 50, speed: 50, moves: [TACKLE], ...over,
})
const charmander = fighter({ id: 'char', name: 'Charmander', types: ['Fire'], hp: 39, attack: 52, defense: 43, speed: 65, moves: [SCRATCH, EMBER] })
const bulbasaur = fighter({ id: 'bulb', name: 'Bulbasaur', types: ['Grass', 'Poison'], hp: 45, attack: 49, defense: 49, speed: 45, moves: [TACKLE, VINE_WHIP] })
const team = (id: string, ...fighters: ArenaFighter[]): ArenaTeam => ({ id, name: `${id} Gym`, fighters })

/** Runs the generator to the end. */
function run(a: ArenaTeam, b: ArenaTeam, rng: Rng = () => 0.5): { turns: ArenaTurn[]; outcome: ArenaOutcome } {
  const gen = simulateArena(a, b, chart, rng)
  const turns: ArenaTurn[] = []
  for (;;) {
    const step = gen.next()
    if (step.done) return { turns, outcome: step.value }
    turns.push(step.value)
  }
}

describe('damage', () => {
  it('damage matches the formula', () => {
    // ((2·5/5+2)·40·52/49)/50 + 2 = 5.396 → ×2 → ×0.85 = 9.17 / ×0.99985 = 10.79
    expect(damage(charmander, bulbasaur, EMBER, 2, 0)).toBe(9)
    expect(damage(charmander, bulbasaur, EMBER, 2, 0.999)).toBe(10)
  })

  it('damage is 0 when eff is 0 and at least 1 otherwise', () => {
    expect(damage(charmander, bulbasaur, TACKLE, 0, 0.5)).toBe(0)
    const weak = fighter({ id: 'w', level: 1, attack: 5 })
    const wall = fighter({ id: 'x', defense: 200 })
    expect(damage(weak, wall, move('Poke', 'Normal', 10), 0.25, 0)).toBe(1)
  })
})

describe('moveEffectiveness', () => {
  it('multiplies over dual types (Ice vs Grass/Flying = 4) and null type is 1', () => {
    expect(moveEffectiveness('Ice', ['Grass', 'Flying'], chart)).toBe(4)
    expect(moveEffectiveness('Fire', ['Grass', 'Poison'], chart)).toBe(2)
    expect(moveEffectiveness('Grass', ['Fire', 'Grass'], chart)).toBe(0.25)
    expect(moveEffectiveness('Normal', ['Ghost'], chart)).toBe(0)
    expect(moveEffectiveness(null, ['Ghost'], chart)).toBe(1)
  })
})

describe('simulateArena', () => {
  it('uses the strongest move against the current defender', () => {
    const { turns } = run(team('A', charmander), team('B', bulbasaur))
    expect(turns.find((t) => t.attackerId === 'char')?.move).toBe('Ember') // 40×2 beats Scratch 40×1
    expect(turns.find((t) => t.attackerId === 'bulb')?.move).toBe('Tackle') // 40×1 beats Vine Whip 45×0.5
  })

  it('faster fighter attacks first; tie goes to A', () => {
    expect(run(team('A', bulbasaur), team('B', charmander)).turns[0].attackerId).toBe('char')
    const twinA = fighter({ id: 'a1', speed: 50 })
    const twinB = fighter({ id: 'b1', speed: 50 })
    expect(run(team('A', twinA), team('B', twinB)).turns[0].side).toBe('A')
  })

  it('the two alternate within a matchup', () => {
    const { turns } = run(team('A', charmander), team('B', bulbasaur))
    const firstMatchup = turns.filter((t) => t.matchup === 1)
    firstMatchup.slice(1).forEach((t, i) => expect(t.side).not.toBe(firstMatchup[i].side))
  })

  it('winner stays in with remaining HP and meets the next opponent', () => {
    const strong = fighter({ id: 'strong', attack: 120, hp: 80, speed: 90 })
    const w1 = fighter({ id: 'w1', hp: 20, attack: 60, speed: 10 })
    const w2 = fighter({ id: 'w2', hp: 20, attack: 60, speed: 10 })
    const { turns } = run(team('A', strong), team('B', w1, w2))

    const lastHitOnStrongInMatchup1 = turns.filter((t) => t.matchup === 1 && t.defenderId === 'strong').at(-1)
    const firstHitOnStrongInMatchup2 = turns.find((t) => t.matchup === 2 && t.defenderId === 'strong')!
    const hpBefore = lastHitOnStrongInMatchup1 ? lastHitOnStrongInMatchup1.defenderHpLeft : strong.hp + 2 * strong.level
    expect(firstHitOnStrongInMatchup2.defenderHpLeft).toBe(hpBefore - firstHitOnStrongInMatchup2.damage)
    expect(turns.filter((t) => t.matchup === 2).every((t) => [t.attackerId, t.defenderId].includes('w2'))).toBe(true)
  })

  it('battle ends when one team has no fighters; winner is the other', () => {
    const { turns, outcome } = run(team('A', charmander), team('B', bulbasaur))
    expect(outcome).toMatchObject({ winner: 'A', endedBy: 'knockout', survivorsA: 1, survivorsB: 0, turnCount: turns.length })
    expect(turns.at(-1)).toMatchObject({ defenderId: 'bulb', defenderHpLeft: 0, fainted: true })
  })

  it('ends when both sides are immune (Struggle)', () => {
    const ghost = fighter({ id: 'ghost', types: ['Ghost'], moves: [move('Lick', 'Ghost', 30)] })
    const normal = fighter({ id: 'normal', types: ['Normal'], moves: [TACKLE] })
    const { turns, outcome } = run(team('A', ghost), team('B', normal))
    expect(outcome.endedBy).toBe('knockout')
    expect(turns.every((t) => t.move === STRUGGLE.name && t.damage > 0)).toBe(true)
  })

  it('stops at MAX_TURNS and decides by survivors then HP%', () => {
    const tankA = fighter({ id: 'tankA', hp: 100_000, attack: 300, moves: [move('Poke', 'Normal', 1)] })
    const tankB = fighter({ id: 'tankB', hp: 100_000, attack: 10, moves: [move('Poke', 'Normal', 1)] })
    const { turns, outcome } = run(team('A', tankA), team('B', tankB))
    expect(turns).toHaveLength(MAX_TURNS)
    expect(outcome).toMatchObject({ endedBy: 'turnLimit', winner: 'A', survivorsA: 1, survivorsB: 1 })
  })

  it('yields turns with consecutive n starting at 1 and defenderHpLeft never below 0', () => {
    const { turns } = run(team('A', charmander, fighter({ id: 'x' })), team('B', bulbasaur, fighter({ id: 'y' })), mulberry32(3))
    turns.forEach((t, i) => {
      expect(t.n).toBe(i + 1)
      expect(t.defenderHpLeft).toBeGreaterThanOrEqual(0)
      expect(t.fainted).toBe(t.defenderHpLeft === 0)
    })
  })

  it('is deterministic for a seed', () => {
    const a = team('A', charmander, fighter({ id: 'x' }))
    const b = team('B', bulbasaur, fighter({ id: 'y' }))
    expect(run(a, b, mulberry32(7))).toEqual(run(a, b, mulberry32(7)))
  })

  it('fought lists every fighter that appeared, mvp = most KOs then damage', () => {
    const s1 = fighter({ id: 's1', attack: 200, speed: 99 })
    const s2 = fighter({ id: 's2' })
    const w1 = fighter({ id: 'w1', hp: 10 })
    const { outcome } = run(team('A', s1, s2), team('B', w1))
    expect(outcome.fought.sort()).toEqual(['s1', 'w1'])
    expect(outcome.mvp).toMatchObject({ id: 's1', kos: 1 })
  })
})

describe('toArenaTeam and validateArena', () => {
  const ready = (id: string, dexNumber: number) => makePokemon({ id, name: id, dexNumber, status: 'Ready', energy: 2, level: 5 })

  it('toArenaTeam uses eligibleFighters order and Struggle-only when the moveset is empty', () => {
    const gym = makeGym({ id: 'g', name: 'G', roster: [ready('p1', 4), makePokemon({ id: 'p2', status: 'Resting', energy: 0 }), ready('p3', 7)] })
    const t = toArenaTeam(gym, new Map([[4, [EMBER]], [7, []]]))
    expect(t.fighters.map((f) => f.id)).toEqual(['p1', 'p3'])
    expect(t.fighters[0].moves).toEqual([EMBER])
    expect(t.fighters[1].moves).toEqual([STRUGGLE])
  })

  it('validateArena reports SAME_GYM first, then the side with no eligible fighter', () => {
    const ok = makeGym({ id: 'a', roster: [ready('p1', 4)] })
    const none = makeGym({ id: 'b', roster: [makePokemon({ id: 'p2', status: 'Resting', energy: 0 })] })
    expect(validateArena(ok, ok)).toEqual({ ok: false, error: 'SAME_GYM' })
    expect(validateArena(none, ok)).toEqual({ ok: false, error: 'A_NOT_ELIGIBLE' })
    expect(validateArena(ok, none)).toEqual({ ok: false, error: 'B_NOT_ELIGIBLE' })
    expect(validateArena(ok, makeGym({ id: 'c', roster: [ready('p3', 7)] }))).toEqual({ ok: true })
  })
})
