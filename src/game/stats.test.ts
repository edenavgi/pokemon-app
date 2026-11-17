import { describe, expect, it } from 'vitest'
import { gymStats } from './stats'
import { makeGym, makePokemon } from './testUtils'

describe('gymStats', () => {
  it('returns empty results with no input', () => {
    expect(gymStats({})).toEqual({ perGym: [], perStatus: null })
  })

  it('aggregates gyms only, with the unrounded mean of mirroredLevels', () => {
    const gyms = [
      makeGym({ id: 'g1', name: 'A', roster: [makePokemon({ id: 'a' }), makePokemon({ id: 'b' })], mirroredLevels: [1, 4] }),
      makeGym({ id: 'g2', name: 'B' }),
    ]
    expect(gymStats({ gyms })).toEqual({
      perGym: [
        { gymId: 'g1', name: 'A', count: 2, avgLevel: 2.5 },
        { gymId: 'g2', name: 'B', count: 0, avgLevel: null },
      ],
      perStatus: null,
    })
  })

  it('groups pokemon only by gym in first-seen order, no-gym last, with all statuses', () => {
    const pokemon = [
      makePokemon({ id: '1', level: 2, status: 'Ready', gym: null }),
      makePokemon({ id: '2', level: 1, status: 'Training', gym: { id: 'g2', name: 'Two', type: null } }),
      makePokemon({ id: '3', level: 4, status: 'Training', gym: { id: 'g1', name: 'One', type: 'Fire' } }),
      makePokemon({ id: '4', level: 4, status: 'Training', gym: { id: 'g2', name: 'Two', type: null } }),
    ]
    const r = gymStats({ pokemon })
    expect(r.perGym).toEqual([
      { gymId: 'g2', name: 'Two', count: 2, avgLevel: 2.5 },
      { gymId: 'g1', name: 'One', count: 1, avgLevel: 4 },
      { gymId: 'none', name: 'No gym', count: 1, avgLevel: 2 },
    ])
    expect(r.perStatus).toEqual({ Recruited: 0, Training: 3, Ready: 1, Resting: 0 })
    expect(Object.keys(r.perStatus ?? {})).toEqual(['Recruited', 'Training', 'Ready', 'Resting'])
  })

  it('uses gyms for perGym and pokemon for perStatus when both are given', () => {
    const r = gymStats({
      gyms: [makeGym({ id: 'g1', name: 'A', roster: [makePokemon()], mirroredLevels: [3] })],
      pokemon: [makePokemon({ status: 'Resting' }), makePokemon({ id: 'p2', status: 'Resting' })],
    })
    expect(r.perGym).toEqual([{ gymId: 'g1', name: 'A', count: 1, avgLevel: 3 }])
    expect(r.perStatus).toEqual({ Recruited: 0, Training: 0, Ready: 0, Resting: 2 })
  })
})
