import { describe, expect, it } from 'vitest'
import { MAX_ROSTER } from './constants'
import { canJoinGym, validateTransfer } from './roster'
import { makeGym, makePokemon } from './testUtils'

const mons = (n: number, prefix = 'r') =>
  Array.from({ length: n }, (_, i) => makePokemon({ id: `${prefix}${i}`, name: `${prefix}${i}` }))

describe('canJoinGym', () => {
  it('accepts a matching type', () => {
    expect(canJoinGym({ types: ['Fire'] }, makeGym({ type: 'Fire' }))).toEqual({ ok: true })
  })
  it('accepts when any type matches', () => {
    expect(canJoinGym({ types: ['Grass', 'Poison'] }, makeGym({ type: 'Poison' }))).toEqual({ ok: true })
  })
  it('rejects a mismatched type', () => {
    expect(canJoinGym({ types: ['Water'] }, makeGym({ type: 'Fire' }))).toEqual({ ok: false, error: 'TYPE_MISMATCH' })
  })
  it('rejects a gym without a type', () => {
    expect(canJoinGym({ types: ['Fire'] }, makeGym({ type: null }))).toEqual({ ok: false, error: 'GYM_HAS_NO_TYPE' })
  })
  it('rejects a full gym', () => {
    const gym = makeGym({ roster: mons(MAX_ROSTER) })
    expect(canJoinGym({ types: ['Fire'] }, gym)).toEqual({ ok: false, error: 'ROSTER_FULL' })
  })
  it('checks type before capacity', () => {
    const gym = makeGym({ roster: mons(MAX_ROSTER) })
    expect(canJoinGym({ types: ['Water'] }, gym)).toEqual({ ok: false, error: 'TYPE_MISMATCH' })
  })
  it('checks no-type before capacity', () => {
    const gym = makeGym({ type: null, roster: mons(MAX_ROSTER) })
    expect(canJoinGym({ types: ['Fire'] }, gym)).toEqual({ ok: false, error: 'GYM_HAS_NO_TYPE' })
  })
})

describe('validateTransfer', () => {
  it('moves matching Pokemon', () => {
    const a = makePokemon({ id: 'a', name: 'A' })
    const res = validateTransfer([a], makeGym())
    expect(res).toEqual({ ok: true, moving: [a], alreadyThere: [] })
  })
  it('fails the whole batch and lists every failing name', () => {
    const ok = makePokemon({ id: 'a', name: 'A' })
    const w1 = makePokemon({ id: 'b', name: 'B', types: ['Water'] })
    const w2 = makePokemon({ id: 'c', name: 'C', types: ['Grass'] })
    expect(validateTransfer([ok, w1, w2], makeGym())).toEqual({
      ok: false,
      error: 'TYPE_MISMATCH',
      names: ['B', 'C'],
    })
  })
  it('reports a typeless gym', () => {
    const a = makePokemon({ id: 'a', name: 'A' })
    expect(validateTransfer([a], makeGym({ type: null }))).toEqual({
      ok: false,
      error: 'GYM_HAS_NO_TYPE',
      names: ['A'],
    })
  })
  it('rejects 5 + 2 incoming with ROSTER_FULL and no partial move', () => {
    const gym = makeGym({ roster: mons(MAX_ROSTER - 1) })
    const inc = [makePokemon({ id: 'x', name: 'X' }), makePokemon({ id: 'y', name: 'Y' })]
    const res = validateTransfer(inc, gym)
    expect(res).toEqual({ ok: false, error: 'ROSTER_FULL', names: ['X', 'Y'] })
    expect('moving' in res).toBe(false)
  })
  it('allows filling the gym exactly', () => {
    const gym = makeGym({ roster: mons(MAX_ROSTER - 1) })
    const inc = [makePokemon({ id: 'x', name: 'X' })]
    expect(validateTransfer(inc, gym)).toEqual({ ok: true, moving: inc, alreadyThere: [] })
  })
  it('puts Pokemon already in the target into alreadyThere without counting them', () => {
    const roster = mons(MAX_ROSTER)
    const gym = makeGym({ roster })
    expect(validateTransfer([roster[0]], gym)).toEqual({ ok: true, moving: [], alreadyThere: [roster[0]] })
  })
  it('does not type-check Pokemon already there', () => {
    const odd = makePokemon({ id: 'o', name: 'O', types: ['Water'] })
    const gym = makeGym({ roster: [odd] })
    expect(validateTransfer([odd], gym)).toEqual({ ok: true, moving: [], alreadyThere: [odd] })
  })
  it('counts only moving Pokemon against capacity', () => {
    const roster = mons(MAX_ROSTER - 1)
    const gym = makeGym({ roster })
    const inc = makePokemon({ id: 'x', name: 'X' })
    expect(validateTransfer([roster[0], inc], gym)).toEqual({ ok: true, moving: [inc], alreadyThere: [roster[0]] })
  })
  it('rejects duplicates in the batch', () => {
    const a = makePokemon({ id: 'a', name: 'A' })
    expect(validateTransfer([a, a], makeGym())).toEqual({ ok: false, error: 'DUPLICATE', names: ['A'] })
  })
  it('gives type errors precedence over ROSTER_FULL', () => {
    const gym = makeGym({ roster: mons(MAX_ROSTER - 1) })
    const inc = [makePokemon({ id: 'x', name: 'X' }), makePokemon({ id: 'y', name: 'Y', types: ['Water'] })]
    expect(validateTransfer(inc, gym)).toEqual({ ok: false, error: 'TYPE_MISMATCH', names: ['Y'] })
  })
  it('accepts an empty batch', () => {
    expect(validateTransfer([], makeGym())).toEqual({ ok: true, moving: [], alreadyThere: [] })
  })
})
