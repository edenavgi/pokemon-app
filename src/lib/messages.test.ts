import { describe, expect, it } from 'vitest'
import type { EvoBlock } from '../game/evolution'
import type { JoinError } from '../game/roster'
import type { SparError } from '../game/status'
import { battleErrorText, evoBlockText, joinErrorText, sparErrorText, talkFallbackText } from './messages'

describe('messages', () => {
  it('sparErrorText covers every code and names Pokémon', () => {
    const codes: SparError[] = ['NEED_TWO', 'DUPLICATE', 'NO_GYM', 'DIFFERENT_GYMS', 'NO_ENERGY', 'RESTING']
    for (const c of codes) expect(sparErrorText(c, ['Charmander']).length).toBeGreaterThan(5)
    expect(sparErrorText('NO_ENERGY', ['Charmander'])).toBe('Charmander has no energy left — let it rest first.')
    expect(sparErrorText('RESTING', ['Pikachu', 'Eevee'])).toContain('Pikachu')
    expect(sparErrorText('NO_ENERGY')).toMatch(/no energy/i)
  })

  it('joinErrorText covers every code and names Pokémon', () => {
    const codes: (JoinError | 'DUPLICATE')[] = ['TYPE_MISMATCH', 'ROSTER_FULL', 'GYM_HAS_NO_TYPE', 'DUPLICATE']
    for (const c of codes) expect(joinErrorText(c, ['Squirtle']).length).toBeGreaterThan(5)
    expect(joinErrorText('TYPE_MISMATCH', ['Squirtle'])).toContain('Squirtle')
    expect(joinErrorText('DUPLICATE', ['Squirtle'])).toContain('Squirtle')
    expect(joinErrorText('ROSTER_FULL')).toMatch(/full/i)
  })

  it('evoBlockText covers every code', () => {
    const codes: EvoBlock[] = ['MAX_STAGE', 'NO_LEVEL_EVOLUTION', 'BRANCHING', 'OUTSIDE_GEN1', 'LEVEL_TOO_LOW']
    for (const c of codes) expect(evoBlockText(c, 3).length).toBeGreaterThan(5)
    expect(evoBlockText('LEVEL_TOO_LOW', 3)).toBe('Evolves at level 3')
  })

  it('battleErrorText covers every code', () => {
    expect(battleErrorText('A_NOT_ELIGIBLE')).toMatch(/first gym/i)
    expect(battleErrorText('B_NOT_ELIGIBLE')).toMatch(/second gym/i)
    expect(battleErrorText('SAME_GYM')).toMatch(/different/i)
  })

  it('talkFallbackText names the Pokémon', () => {
    expect(talkFallbackText('Pikachu')).toBe('Pikachu is napping right now. Try again later.')
  })
})
