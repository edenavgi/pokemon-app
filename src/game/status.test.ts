import { describe, expect, it } from 'vitest'
import { allowedTransitions, applyRest, applySpar, deriveStatus, validateSpar } from './status'
import { makePokemon } from './testUtils'

describe('deriveStatus', () => {
  it('maps energy and level to a status', () => {
    expect(deriveStatus({ level: 7, energy: 0 })).toBe('Resting')
    expect(deriveStatus({ level: 5, energy: 1 })).toBe('Ready')
    expect(deriveStatus({ level: 4, energy: 1 })).toBe('Training')
  })
})

describe('applySpar', () => {
  it('levels up and spends energy', () => {
    expect(applySpar(makePokemon({ level: 1, energy: 3 }))).toEqual({ level: 2, energy: 2, status: 'Training' })
  })
  it('becomes Ready at level 5', () => {
    expect(applySpar(makePokemon({ level: 4, energy: 2 }))).toEqual({ level: 5, energy: 1, status: 'Ready' })
  })
  it('rests at zero energy', () => {
    expect(applySpar(makePokemon({ level: 4, energy: 1 }))).toEqual({ level: 5, energy: 0, status: 'Resting' })
  })
  it('clamps energy at 0', () => {
    expect(applySpar(makePokemon({ level: 2, energy: 0 })).energy).toBe(0)
  })
})

describe('validateSpar', () => {
  const a = makePokemon({ id: 'a', name: 'A' })
  const b = makePokemon({ id: 'b', name: 'B' })
  it('needs exactly two', () => {
    expect(validateSpar([a])).toEqual({ ok: false, error: 'NEED_TWO' })
    expect(validateSpar([a, b, makePokemon({ id: 'c' })])).toEqual({ ok: false, error: 'NEED_TWO' })
  })
  it('rejects duplicates', () => {
    expect(validateSpar([a, a])).toEqual({ ok: false, error: 'DUPLICATE' })
  })
  it('rejects missing gym', () => {
    const b = makePokemon({ id: 'b', name: 'Bee', gym: null })
    expect(validateSpar([a, b])).toEqual({ ok: false, error: 'NO_GYM', names: ['Bee'] })
    const c = makePokemon({ id: 'c', name: 'Cee', gym: null })
    expect(validateSpar([b, c])).toEqual({ ok: false, error: 'NO_GYM', names: ['Bee', 'Cee'] })
  })
  it('rejects different gyms', () => {
    const other = makePokemon({ id: 'b', gym: { id: 'g2', name: 'Other', type: null } })
    expect(validateSpar([a, other])).toEqual({ ok: false, error: 'DIFFERENT_GYMS' })
  })
  it('rejects resting with names', () => {
    const r = makePokemon({ id: 'b', name: 'B', status: 'Resting' })
    expect(validateSpar([a, r])).toEqual({ ok: false, error: 'RESTING', names: ['B'] })
  })
  it('rejects no energy with names', () => {
    const z = makePokemon({ id: 'b', name: 'B', energy: 0 })
    expect(validateSpar([a, z])).toEqual({ ok: false, error: 'NO_ENERGY', names: ['B'] })
  })
  it('accepts a valid pair', () => {
    expect(validateSpar([a, b])).toEqual({ ok: true })
  })
})

describe('applyRest', () => {
  it('restores energy to Training below level 5', () => {
    expect(applyRest(makePokemon({ level: 3, energy: 0, status: 'Resting' }))).toEqual({ energy: 3, status: 'Training' })
  })
  it('restores energy to Ready at level 5+', () => {
    expect(applyRest(makePokemon({ level: 5, energy: 0, status: 'Resting' }))).toEqual({ energy: 3, status: 'Ready' })
  })
})

describe('allowedTransitions', () => {
  it('Recruited -> Training', () => {
    expect(allowedTransitions(makePokemon({ status: 'Recruited' }))).toEqual({ to: ['Training'], canRest: false })
  })
  it('Training below ready level -> Resting', () => {
    expect(allowedTransitions(makePokemon({ status: 'Training', level: 4 }))).toEqual({ to: ['Resting'], canRest: false })
  })
  it('Training at ready level -> Ready, Resting', () => {
    expect(allowedTransitions(makePokemon({ status: 'Training', level: 5 }))).toEqual({ to: ['Ready', 'Resting'], canRest: false })
  })
  it('Ready -> Training, Resting', () => {
    expect(allowedTransitions(makePokemon({ status: 'Ready', level: 5 }))).toEqual({ to: ['Training', 'Resting'], canRest: false })
  })
  it('Resting -> none, can rest', () => {
    expect(allowedTransitions(makePokemon({ status: 'Resting' }))).toEqual({ to: [], canRest: true })
  })
})
