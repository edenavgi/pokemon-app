import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { MockGameApi } from '../../api/mock/MockGameApi'
import { battle, battleSummary } from '../../game/battle'
import { mulberry32 } from '../../game/rng'
import { battleErrorText } from '../../lib/messages'
import { ArenaTab } from './ArenaTab'
import { polyfillSelect, renderTab } from './testHarness'

beforeAll(polyfillSelect)

const setup = () => {
  const api = new MockGameApi()
  const post = vi.spyOn(api, 'postUpdate')
  renderTab(api, (gyms) => <ArenaTab gyms={gyms} rng={mulberry32(42)} />)
  return { api, post }
}

async function choose(label: string, name: string) {
  await userEvent.click(await screen.findByRole('combobox', { name: label }))
  await userEvent.click(await screen.findByRole('option', { name }))
}

describe('ArenaTab', () => {
  it('disables Battle until two gyms are chosen', async () => {
    setup()
    const btn = await screen.findByRole('button', { name: 'Battle' })
    expect(btn).toBeDisabled()
    await choose('First gym', 'Cinnabar Gym')
    expect(btn).toBeDisabled()
    await choose('Second gym', 'Cerulean Gym')
    expect(btn).toBeEnabled()
  })

  it('does not offer the already-chosen gym in the other select', async () => {
    setup()
    await choose('First gym', 'Cinnabar Gym')
    await userEvent.click(screen.getByRole('combobox', { name: 'Second gym' }))
    expect(await screen.findByRole('option', { name: 'Cinnabar Gym' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('option', { name: 'Cerulean Gym' })).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('plays the battle, shows the table and posts the summary on both gyms', async () => {
    const { api, post } = setup()
    await choose('First gym', 'Cinnabar Gym')
    await choose('Second gym', 'Cerulean Gym')
    await userEvent.click(screen.getByRole('button', { name: 'Battle' }))

    const gyms = await api.listGyms()
    const [a, b] = [gyms[0], gyms[1]]
    const expected = battle(a, b, await api.getTypeChart(), mulberry32(42))
    if (!expected.ok) throw new Error('expected ok')

    const table = await screen.findByRole('table')
    const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads).toEqual(['#', 'A', 'Score', 'B', 'Score', 'Winner'])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(expected.rounds.length)
    expect(rows[0]).toHaveTextContent('Charmander')
    expect(rows[0]).toHaveTextContent('Squirtle')
    expect(rows[0]).toHaveTextContent(expected.rounds[0].scoreA.toFixed(1))
    const winningRows = rows.filter((r) => r.hasAttribute('data-winner'))
    expect(winningRows).toHaveLength(expected.rounds.filter((r) => r.winner !== 'draw').length)

    const winnerName = expected.winner === 'A' ? a.name : b.name
    expect(screen.getByRole('status')).toHaveTextContent(`${winnerName} wins the battle!`)

    const summary = battleSummary(a, b, expected)
    expect(post).toHaveBeenCalledTimes(2)
    expect(post).toHaveBeenCalledWith(a.id, summary)
    expect(post).toHaveBeenCalledWith(b.id, summary)
  })

  it('shows battleErrorText and no table when a gym has nobody ready', async () => {
    const api = new MockGameApi()
    const post = vi.spyOn(api, 'postUpdate')
    const orig = api.listGyms.bind(api)
    api.listGyms = async (o) => (await orig(o)).map((g) => (g.id === 'g2' ? { ...g, roster: [] } : g))
    renderTab(api, (gyms) => <ArenaTab gyms={gyms} rng={mulberry32(1)} />)
    await choose('First gym', 'Cinnabar Gym')
    await choose('Second gym', 'Cerulean Gym')
    await userEvent.click(screen.getByRole('button', { name: 'Battle' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(battleErrorText('B_NOT_ELIGIBLE'))
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  // Cinnabar keeps its two Pokémon but none can fight (one Resting, one at 0 energy).
  it.each([
    ['A_NOT_ELIGIBLE', 'Cinnabar Gym', 'Cerulean Gym'],
    ['B_NOT_ELIGIBLE', 'Cerulean Gym', 'Cinnabar Gym'],
  ] as const)('%s: a non-empty but unfit roster shows the error, no table, no post', async (err, first, second) => {
    const api = new MockGameApi()
    const post = vi.spyOn(api, 'postUpdate')
    const orig = api.listGyms.bind(api)
    api.listGyms = async (o) =>
      (await orig(o)).map((g) =>
        g.id === 'g1'
          ? { ...g, roster: g.roster.map((p, i) => (i === 0 ? { ...p, status: 'Resting' as const } : { ...p, energy: 0 })) }
          : g,
      )
    renderTab(api, (gyms) => <ArenaTab gyms={gyms} rng={mulberry32(1)} />)
    await choose('First gym', first)
    await choose('Second gym', second)
    await userEvent.click(screen.getByRole('button', { name: 'Battle' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(battleErrorText(err))
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it('does not change levels or energy', async () => {
    const { api } = setup()
    const before = JSON.stringify(await api.listPokemon())
    await choose('First gym', 'Cinnabar Gym')
    await choose('Second gym', 'Cerulean Gym')
    await userEvent.click(screen.getByRole('button', { name: 'Battle' }))
    await screen.findByRole('table')
    expect(JSON.stringify(await api.listPokemon())).toBe(before)
  })

  it('still shows the result but warns when posting the update fails', async () => {
    const { post } = setup()
    post.mockRejectedValue(new Error('nope'))
    await choose('First gym', 'Cinnabar Gym')
    await choose('Second gym', 'Cerulean Gym')
    await userEvent.click(screen.getByRole('button', { name: 'Battle' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be posted')
  })

  it('shows an empty state with fewer than two gyms', async () => {
    const api = new MockGameApi()
    const orig = api.listGyms.bind(api)
    api.listGyms = async (o) => (await orig(o)).slice(0, 1)
    renderTab(api, (gyms) => <ArenaTab gyms={gyms} />)
    expect(await screen.findByText('Pick two different gyms to battle.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Battle' })).not.toBeInTheDocument()
  })
})
