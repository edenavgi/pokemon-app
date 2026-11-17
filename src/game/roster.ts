import type { Gym, Pokemon } from '../api/GameApi'
import { MAX_ROSTER } from './constants'

export type JoinError = 'TYPE_MISMATCH' | 'ROSTER_FULL' | 'GYM_HAS_NO_TYPE'
export type JoinValidation = { ok: true } | { ok: false; error: JoinError }
export type TransferValidation =
  | { ok: true; moving: Pokemon[]; alreadyThere: Pokemon[] }
  | { ok: false; error: JoinError | 'DUPLICATE'; names: string[] }

function typeError(p: Pick<Pokemon, 'types'>, gym: Gym): 'GYM_HAS_NO_TYPE' | 'TYPE_MISMATCH' | null {
  if (gym.type === null) return 'GYM_HAS_NO_TYPE'
  return p.types.includes(gym.type) ? null : 'TYPE_MISMATCH'
}

export function canJoinGym(p: Pick<Pokemon, 'types'>, gym: Gym): JoinValidation {
  const error = typeError(p, gym)
  if (error) return { ok: false, error }
  if (gym.roster.length >= MAX_ROSTER) return { ok: false, error: 'ROSTER_FULL' }
  return { ok: true }
}

export function validateTransfer(ps: Pokemon[], target: Gym): TransferValidation {
  const seen = new Set<string>()
  for (const p of ps) {
    if (seen.has(p.id)) return { ok: false, error: 'DUPLICATE', names: [p.name] }
    seen.add(p.id)
  }
  const there = new Set(target.roster.map((r) => r.id))
  const alreadyThere = ps.filter((p) => there.has(p.id))
  const moving = ps.filter((p) => !there.has(p.id))

  const failures = moving.flatMap((p) => {
    const error = typeError(p, target)
    return error ? [{ name: p.name, error }] : []
  })
  if (failures.length > 0) {
    return { ok: false, error: failures[0].error, names: failures.map((f) => f.name) }
  }
  if (target.roster.length + moving.length > MAX_ROSTER) {
    return { ok: false, error: 'ROSTER_FULL', names: moving.map((p) => p.name) }
  }
  return { ok: true, moving, alreadyThere }
}
