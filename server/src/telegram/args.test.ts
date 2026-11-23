import { describe, expect, it } from 'vitest'
import { makeGym, makePokemon } from '@app/game/testUtils'
import { matchGym, matchPokemon, parseCommand, splitTwoGyms } from './args'
import { texts } from './texts'

const BOT = 'eden_gym_bot'

describe('parseCommand', () => {
  it('strips @botname and splits the args', () => {
    expect(parseCommand('/roster@eden_gym_bot Cinnabar Gym', BOT)).toEqual({ name: 'roster', args: ['Cinnabar', 'Gym'] })
  })

  it('keeps quoted args as one token, also with the curly quotes phones type', () => {
    expect(parseCommand('/battle "Cinnabar Gym" Cerulean', BOT)).toEqual({ name: 'battle', args: ['Cinnabar Gym', 'Cerulean'] })
    expect(parseCommand('/battle “Cinnabar Gym” Cerulean', BOT)).toEqual({ name: 'battle', args: ['Cinnabar Gym', 'Cerulean'] })
  })

  it('lowercases the command, ignores extra spaces', () => {
    expect(parseCommand('  /GYMS   ', BOT)).toEqual({ name: 'gyms', args: [] })
  })

  it('plain text, or a command for another bot → null', () => {
    expect(parseCommand('hello', BOT)).toBeNull()
    expect(parseCommand('/gyms@other_bot', BOT)).toBeNull()
    expect(parseCommand('/gyms@EDEN_GYM_BOT', BOT)).toEqual({ name: 'gyms', args: [] })
  })
})

describe('matchGym', () => {
  const gyms = [makeGym({ id: 'g1', name: 'Cinnabar Gym' }), makeGym({ id: 'g2', name: 'Citrine' }), makeGym({ id: 'g3', name: 'Cerulean Gym' })]

  it('is case-insensitive and the trailing " gym" is optional', () => {
    expect(matchGym('cinnabar', gyms)).toMatchObject({ ok: true, gym: { id: 'g1' } })
    expect(matchGym('CINNABAR GYM', gyms)).toMatchObject({ ok: true, gym: { id: 'g1' } })
    expect(matchGym('citrine gym', gyms)).toMatchObject({ ok: true, gym: { id: 'g2' } })
  })

  it('accepts a unique prefix', () => {
    expect(matchGym('cer', gyms)).toMatchObject({ ok: true, gym: { id: 'g3' } })
  })

  it('an exact name wins over a longer name that starts with it', () => {
    const two = [makeGym({ id: 'a', name: 'Pewter' }), makeGym({ id: 'b', name: 'Pewter City' })]
    expect(matchGym('pewter', two)).toMatchObject({ ok: true, gym: { id: 'a' } })
  })

  it('a prefix of two gyms → ambiguous, naming both', () => {
    expect(matchGym('Ci', gyms)).toEqual({ ok: false, reply: texts.ambiguousGym('Ci', ['Cinnabar Gym', 'Citrine']) })
  })

  it('no match → unknown, listing the gym names', () => {
    expect(matchGym('Nope', gyms)).toEqual({ ok: false, reply: texts.unknownGym('Nope', ['Cinnabar Gym', 'Citrine', 'Cerulean Gym']) })
  })
})

describe('splitTwoGyms', () => {
  const gyms = [makeGym({ id: 'g1', name: 'Cinnabar Gym' }), makeGym({ id: 'g2', name: 'Cerulean Gym' })]

  it('finds the one split where both halves are gyms', () => {
    expect(splitTwoGyms(['Cinnabar', 'Gym', 'Cerulean', 'Gym'], gyms)).toMatchObject({ ok: true, a: { id: 'g1' }, b: { id: 'g2' } })
    expect(splitTwoGyms(['Cinnabar Gym', 'cerulean'], gyms)).toMatchObject({ ok: true, a: { id: 'g1' }, b: { id: 'g2' } })
  })

  it('two splits that both work → ambiguous, asking for quotes', () => {
    const abc = [makeGym({ id: 'ab', name: 'A B' }), makeGym({ id: 'c', name: 'C' }), makeGym({ id: 'a', name: 'A' }), makeGym({ id: 'bc', name: 'B C' })]
    expect(splitTwoGyms(['A', 'B', 'C'], abc)).toEqual({ ok: false, reply: texts.ambiguousSplit })
  })

  it('no split works → says so, asking for quotes', () => {
    expect(splitTwoGyms(['Cinnabar', 'Nope'], gyms)).toEqual({ ok: false, reply: texts.noSplit })
  })

  it('fewer than two words → usage', () => {
    expect(splitTwoGyms(['Cinnabar'], gyms)).toEqual({ ok: false, reply: texts.usage('/battle <gym> <gym>') })
  })
})

describe('matchPokemon', () => {
  const gym = { id: 'g1', name: 'Cinnabar Gym', type: 'Fire' as const }
  const mon = [
    makePokemon({ id: '101', name: 'Charmander', level: 5, gym }),
    makePokemon({ id: '102', name: 'Charmander', level: 9, gym: null }),
    makePokemon({ id: '103', name: 'Charmeleon', level: 18, gym }),
    makePokemon({ id: '104', name: 'Squirtle', level: 7, gym: null }),
  ]

  it('by name, case-insensitive, and by a unique prefix', () => {
    expect(matchPokemon('squirtle', mon)).toMatchObject({ ok: true, p: { id: '104' } })
    expect(matchPokemon('charme', mon)).toMatchObject({ ok: true, p: { id: '103' } })
  })

  it('an all-digit query is an item ID', () => {
    expect(matchPokemon('102', mon)).toMatchObject({ ok: true, p: { id: '102' } })
    expect(matchPokemon('999', mon)).toEqual({ ok: false, reply: texts.unknownPokemon('999') })
  })

  it('two with the same name → ambiguous, listing gym, level and ID', () => {
    const r = matchPokemon('charmander', mon)
    expect(r).toEqual({ ok: false, reply: texts.ambiguousPokemon([mon[0], mon[1]]) })
    if (r.ok) throw new Error('expected ambiguous')
    expect(r.reply).toContain('Charmander (Cinnabar Gym, Lv 5, id 101)')
    expect(r.reply).toContain('Charmander (no gym, Lv 9, id 102)')
  })

  it('no match → unknown', () => {
    expect(matchPokemon('mewtwo', mon)).toEqual({ ok: false, reply: texts.unknownPokemon('mewtwo') })
  })
})
