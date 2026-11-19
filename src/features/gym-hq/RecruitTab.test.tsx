import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { MockGameApi } from '../../api/mock/MockGameApi'
import { joinErrorText } from '../../lib/messages'
import { RecruitTab } from './RecruitTab'
import { polyfillSelect, renderTab } from './testHarness'

beforeAll(polyfillSelect)

const setup = () => {
  const api = new MockGameApi()
  const getSpecies = vi.spyOn(api, 'getSpecies')
  const recruit = vi.spyOn(api, 'recruit')
  renderTab(api, (gyms, reload) => <RecruitTab gyms={gyms} reload={reload} />)
  return { api, getSpecies, recruit }
}

const grid = () => screen.getByRole('list', { name: 'Pokémon' })
const pick = (name: string) => userEvent.click(within(grid()).getByRole('button', { name: new RegExp(name) }))
async function pickGym(name: string) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Gym' }))
  await userEvent.click(await screen.findByRole('option', { name }))
}

describe('RecruitTab', () => {
  it('shows species with sprite, name and types', async () => {
    setup()
    const charizard = await within(await screen.findByRole('list', { name: 'Pokémon' })).findByRole('button', { name: /Charizard/ })
    expect(within(charizard).getByAltText('Charizard')).toBeInTheDocument()
    expect(within(charizard).getByText('Flying')).toBeInTheDocument()
  })

  it('searches by name', async () => {
    setup()
    await userEvent.type(await screen.findByLabelText('Search by name'), 'char')
    expect(within(grid()).getAllByRole('button')).toHaveLength(3)
    await userEvent.type(screen.getByLabelText('Search by name'), 'zzz')
    expect(screen.getByText('No Pokémon match your search')).toBeInTheDocument()
  })

  it('filters by type', async () => {
    setup()
    await screen.findByRole('list', { name: 'Pokémon' })
    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by type' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Fire' }))
    const names = within(grid()).getAllByRole('button').map((b) => b.textContent)
    expect(names).toHaveLength(4) // Charmander, Charmeleon, Charizard, Flareon
    expect(names.join(' ')).not.toMatch(/Squirtle/)
  })

  it('keeps Recruit disabled until a Pokémon and a gym are chosen', async () => {
    setup()
    await screen.findByRole('list', { name: 'Pokémon' })
    const btn = screen.getByRole('button', { name: 'Recruit' })
    expect(btn).toBeDisabled()
    await pick('Squirtle')
    expect(btn).toBeDisabled()
    await pickGym('Cerulean Gym')
    expect(btn).toBeEnabled()
  })

  it('invalid join shows the message and calls neither getSpecies nor recruit', async () => {
    const { getSpecies, recruit, api } = setup()
    await screen.findByRole('list', { name: 'Pokémon' })
    await pick('Squirtle')
    await pickGym('Cinnabar Gym')
    await userEvent.click(screen.getByRole('button', { name: 'Recruit' }))
    expect(screen.getByRole('alert')).toHaveTextContent(joinErrorText('TYPE_MISMATCH', ['Squirtle']))
    expect(getSpecies).not.toHaveBeenCalled()
    expect(recruit).not.toHaveBeenCalled()
    expect(api.notices).toEqual([])
  })

  it('a full gym is rejected before any API call', async () => {
    const { getSpecies, recruit } = setup()
    await screen.findByRole('list', { name: 'Pokémon' })
    await pick('Bulbasaur')
    await pickGym('Celadon Gym')
    await userEvent.click(screen.getByRole('button', { name: 'Recruit' }))
    expect(screen.getByRole('alert')).toHaveTextContent(joinErrorText('ROSTER_FULL'))
    expect(getSpecies).not.toHaveBeenCalled()
    expect(recruit).not.toHaveBeenCalled()
  })

  it('valid join fetches the species, recruits, notifies and refreshes the roster', async () => {
    const { api, getSpecies, recruit } = setup()
    await screen.findByRole('list', { name: 'Pokémon' })
    await pick('Squirtle')
    await pickGym('Cerulean Gym')
    await userEvent.click(screen.getByRole('button', { name: 'Recruit' }))
    await waitFor(() => expect(api.notices).toHaveLength(1))
    expect(getSpecies).toHaveBeenCalledWith(7)
    expect(recruit).toHaveBeenCalledTimes(1)
    expect(recruit.mock.calls[0][0]).toMatchObject({ gymId: 'g2', species: { dexNumber: 7, name: 'Squirtle' } })
    expect(api.notices).toEqual([{ message: 'Squirtle joined Cerulean Gym.', type: 'success' }])
    expect((await api.getGym('g2')).roster.map((p) => p.name)).toContain('Squirtle')
    expect(screen.getByRole('button', { name: 'Recruit' })).toBeDisabled() // selection cleared
  })

  it('a failed recruit shows an error and no success notice', async () => {
    const { api, recruit } = setup()
    recruit.mockRejectedValueOnce(new Error('boom'))
    await screen.findByRole('list', { name: 'Pokémon' })
    await pick('Squirtle')
    await pickGym('Cerulean Gym')
    await userEvent.click(screen.getByRole('button', { name: 'Recruit' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(api.notices.filter((n) => n.type === 'success')).toEqual([])
  })

  it('does not double-submit while busy', async () => {
    const { recruit } = setup()
    await screen.findByRole('list', { name: 'Pokémon' })
    await pick('Squirtle')
    await pickGym('Cerulean Gym')
    const btn = screen.getByRole('button', { name: 'Recruit' })
    await userEvent.dblClick(btn)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Recruit' })).toBeDisabled())
    await new Promise((r) => setTimeout(r, 50))
    expect(recruit).toHaveBeenCalledTimes(1)
  })

  it('shows an error state when the species list fails', async () => {
    const api = new MockGameApi()
    api.listGen1 = async () => { throw new Error('no dex') }
    renderTab(api, (gyms, reload) => <RecruitTab gyms={gyms} reload={reload} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('no dex')
  })
})
