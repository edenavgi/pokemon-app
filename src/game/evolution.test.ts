import { describe, expect, it } from 'vitest'
import type { EvolutionInfo, SpeciesDetail } from '../api/GameApi'
import { applyEvolution, evolutionCheck, evolutionMessage } from './evolution'
import { makePokemon } from './testUtils'

const lvl = (dexNumber: number, name: string) => ({ dexNumber, name, trigger: 'level-up' as const, minLevel: 16 })

const charmander: EvolutionInfo = { stage: 1, next: [lvl(5, 'Charmeleon')] }
const charmeleon: EvolutionInfo = { stage: 2, next: [lvl(6, 'Charizard')] }
const charizard: EvolutionInfo = { stage: 3, next: [] }

describe('evolutionCheck', () => {
  it('evolves stage 1 at level 3', () => {
    expect(evolutionCheck(makePokemon({ level: 3 }), charmander)).toEqual({ eligible: true, target: lvl(5, 'Charmeleon') })
  })
  it('blocks stage 1 below level 3', () => {
    expect(evolutionCheck(makePokemon({ level: 2 }), charmander)).toEqual({ eligible: false, reason: 'LEVEL_TOO_LOW', atLevel: 3 })
  })
  it('blocks stage 2 at level 5, allows at 6', () => {
    expect(evolutionCheck(makePokemon({ level: 5 }), charmeleon)).toEqual({ eligible: false, reason: 'LEVEL_TOO_LOW', atLevel: 6 })
    expect(evolutionCheck(makePokemon({ level: 6 }), charmeleon)).toEqual({ eligible: true, target: lvl(6, 'Charizard') })
  })
  it('blocks max stage', () => {
    expect(evolutionCheck(makePokemon({ level: 9 }), charizard)).toEqual({ eligible: false, reason: 'MAX_STAGE' })
  })
  it('blocks non-level triggers', () => {
    const pikachu: EvolutionInfo = { stage: 2, next: [{ dexNumber: 26, name: 'Raichu', trigger: 'other', minLevel: null }] }
    expect(evolutionCheck(makePokemon({ level: 9 }), pikachu)).toEqual({ eligible: false, reason: 'NO_LEVEL_EVOLUTION' })
  })
  it('blocks branching', () => {
    const eevee: EvolutionInfo = { stage: 1, next: [lvl(134, 'Vaporeon'), lvl(135, 'Jolteon')] }
    expect(evolutionCheck(makePokemon({ level: 9 }), eevee)).toEqual({ eligible: false, reason: 'BRANCHING' })
  })
  it('blocks evolutions outside Gen 1', () => {
    const golbat: EvolutionInfo = { stage: 2, next: [lvl(169, 'Crobat')] }
    expect(evolutionCheck(makePokemon({ level: 9 }), golbat)).toEqual({ eligible: false, reason: 'OUTSIDE_GEN1' })
  })
})

describe('applyEvolution', () => {
  const species: SpeciesDetail = {
    dexNumber: 5, name: 'Charmeleon', types: ['Fire'], spriteUrl: 'https://example.test/5.png',
    hp: 58, attack: 64, defense: 58, speed: 80, flavorText: 'x',
  } as SpeciesDetail
  it('returns only species-derived keys', () => {
    const patch = applyEvolution(species)
    expect(patch).toEqual({
      name: 'Charmeleon', dexNumber: 5, types: ['Fire'], spriteUrl: 'https://example.test/5.png',
      hp: 58, attack: 64, defense: 58, speed: 80,
    })
    expect(patch).not.toHaveProperty('level')
    expect(patch).not.toHaveProperty('energy')
    expect(patch).not.toHaveProperty('status')
    expect(patch.types).not.toBe(species.types)
  })
})

describe('evolutionMessage', () => {
  it('formats', () => {
    expect(evolutionMessage('Charmeleon', 'Charizard')).toBe('Charmeleon evolved into Charizard')
  })
})
