import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArenaTurn, BattleView } from '../../api/GameApi'
import { BattleReplay } from './BattleReplay'

// A short hand-made battle: Charizard (A) beats Geodude (B) in 3 turns.
const turn = (t: Partial<ArenaTurn> & Pick<ArenaTurn, 'n'>): ArenaTurn => ({
  matchup: 1, side: 'A', attackerId: 'p1', attackerName: 'Charizard', defenderId: 'p2', defenderName: 'Geodude',
  move: 'Ember', moveType: 'Fire', effectiveness: 0.5, damage: 10, defenderHpLeft: 40, defenderMaxHp: 50, fainted: false,
  ...t,
})
const TURNS: ArenaTurn[] = [
  turn({ n: 1 }),
  turn({
    n: 2, side: 'B', attackerId: 'p2', attackerName: 'Geodude', defenderId: 'p1', defenderName: 'Charizard',
    move: 'Rock Throw', moveType: 'Rock', effectiveness: 4, damage: 30, defenderHpLeft: 48, defenderMaxHp: 78,
  }),
  turn({ n: 3, move: 'Flamethrower', damage: 40, defenderHpLeft: 0, fainted: true }),
]
const BATTLE: BattleView = {
  id: 'b1', source: 'app', status: 'done', createdAt: '2026-11-23T09:00:00.000Z',
  gymA: { id: 'g1', name: 'Cinnabar Gym' }, gymB: { id: 'g2', name: 'Pewter Gym' },
  outcome: {
    winner: 'A', endedBy: 'knockout', turnCount: 3, fought: ['p1', 'p2'],
    mvp: { id: 'p1', name: 'Charizard', kos: 1, damage: 50 }, survivorsA: 1, survivorsB: 0,
  },
}

const logLines = () => within(screen.getByRole('log')).queryAllByRole('listitem').map((li) => li.textContent)
const hp = (name: string) => {
  const bar = screen.getByRole('progressbar', { name })
  return [Number(bar.getAttribute('aria-valuenow')), Number(bar.getAttribute('aria-valuemax'))]
}

describe('BattleReplay', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('steps through every turn in order, and its final HP equals the last turn', () => {
    render(<BattleReplay battle={BATTLE} turns={TURNS} stepMs={600} />)
    expect(logLines()).toEqual([])
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(600))
    expect(logLines()).toHaveLength(1)
    expect(logLines()[0]).toContain('Charizard used Ember')
    expect(logLines()[0]).toContain('not very effective')
    expect(hp('Geodude')).toEqual([40, 50])

    act(() => vi.advanceTimersByTime(600))
    expect(logLines()[1]).toContain('Geodude used Rock Throw')
    expect(logLines()[1]).toContain('super effective')
    expect(hp('Charizard')).toEqual([48, 78])

    act(() => vi.advanceTimersByTime(600))
    expect(logLines()).toHaveLength(3)
    expect(logLines()[2]).toContain('Geodude fainted')
    expect(hp('Geodude')).toEqual([TURNS[2].defenderHpLeft, TURNS[2].defenderMaxHp])
    expect(screen.getByRole('status')).toHaveTextContent('Cinnabar Gym wins! MVP: Charizard')

    act(() => vi.advanceTimersByTime(6000))
    expect(logLines()).toHaveLength(3) // stops at the end
  })

  it('Skip jumps to the result', () => {
    render(<BattleReplay battle={BATTLE} turns={TURNS} stepMs={600} />)
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(logLines()).toHaveLength(3)
    expect(hp('Geodude')).toEqual([0, 50])
    expect(screen.getByRole('status')).toHaveTextContent('Cinnabar Gym wins!')
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument()
  })

  it('shows a draw', () => {
    const draw = { ...BATTLE, outcome: { ...BATTLE.outcome!, winner: 'draw' as const, endedBy: 'turnLimit' as const, mvp: null } }
    render(<BattleReplay battle={draw} turns={TURNS} stepMs={600} />)
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.getByRole('status')).toHaveTextContent("It's a draw")
  })
})
