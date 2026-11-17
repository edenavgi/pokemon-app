import { describe, expect, it } from 'vitest'
import type { SpeciesDetail } from '../api/GameApi'
import { buildTalkPrompt } from './talk'

const pikachu: SpeciesDetail = {
  dexNumber: 25, name: 'Pikachu', types: ['Electric'], spriteUrl: 'x', hp: 35, attack: 55, defense: 40, speed: 90,
  flavorText: 'When several of these POKéMON gather, their electricity could build and cause lightning storms.',
}
const raichu: SpeciesDetail = {
  ...pikachu, dexNumber: 26, name: 'Raichu',
  flavorText: 'Its long tail serves as a ground to protect itself from its own high voltage power.',
}

describe('buildTalkPrompt', () => {
  it('builds a Pikachu system prompt with name, type, flavor text and instructions', () => {
    const { system, user } = buildTalkPrompt(pikachu)
    expect(system).toContain('Pikachu')
    expect(system).toContain('Electric')
    expect(system).toContain(pikachu.flavorText)
    expect(system).toMatch(/1.2 short lines/)
    expect(system).toMatch(/catchphrase/i)
    expect(system).toMatch(/in character/i)
    expect(user.trim()).not.toBe('')
  })

  it('reflects the evolved Pokemon only', () => {
    const { system } = buildTalkPrompt(raichu)
    expect(system).toContain('Raichu')
    expect(system).not.toContain('Pikachu')
  })

  it('mentions no other species in the prompt', () => {
    const { system } = buildTalkPrompt(pikachu)
    expect(system).not.toContain('Meowth')
    expect(system).not.toContain('Raichu')
  })

  it('joins multiple types with " and "', () => {
    expect(buildTalkPrompt({ ...pikachu, types: ['Poison', 'Flying'] }).system).toContain('Poison and Flying')
  })

  it('normalises whitespace in flavor text', () => {
    const { system } = buildTalkPrompt({ ...pikachu, flavorText: 'It stores\nelectricity\fin   its cheeks.' })
    expect(system).toContain('It stores electricity in its cheeks.')
    expect(system).not.toMatch(/\f/)
  })
})
