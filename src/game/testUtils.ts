import type { Pokemon } from '../api/GameApi'
import { MAX_ENERGY, START_LEVEL } from './constants'

export function makePokemon(overrides: Partial<Pokemon> = {}): Pokemon {
  return {
    id: 'p1',
    name: 'Charmander',
    dexNumber: 4,
    types: ['Fire'],
    spriteUrl: 'https://example.test/4.png',
    hp: 39,
    attack: 52,
    defense: 43,
    speed: 65,
    level: START_LEVEL,
    energy: MAX_ENERGY,
    status: 'Training',
    gym: { id: 'g1', name: 'Cinnabar Gym', type: 'Fire' },
    ...overrides,
  }
}
