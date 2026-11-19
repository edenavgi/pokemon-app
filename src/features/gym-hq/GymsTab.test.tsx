import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { MockGameApi } from '../../api/mock/MockGameApi'
import { POKE_TYPES } from '../../api/GameApi'
import { GymsTab } from './GymsTab'
import { polyfillSelect, renderTab } from './testHarness'

beforeAll(polyfillSelect)

const setup = () => {
  const api = new MockGameApi()
  const create = vi.spyOn(api, 'createGym')
  renderTab(api, (gyms, reload) => <GymsTab gyms={gyms} reload={reload} />)
  return { api, create }
}

describe('GymsTab', () => {
  it('lists gyms with a roster count n/6', async () => {
    setup()
    expect(await screen.findByText('Cinnabar Gym')).toBeInTheDocument()
    expect(screen.getAllByText('2/6')).toHaveLength(2)
    expect(screen.getByText('6/6')).toBeInTheDocument()
  })

  it('expands a gym to show its roster cards', async () => {
    setup()
    const toggle = await screen.findByRole('button', { name: /Cinnabar Gym/ })
    expect(screen.queryByText('Charmander')).not.toBeInTheDocument()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Charmander')).toBeInTheDocument()
    expect(screen.getByText('Charmeleon')).toBeInTheDocument()
  })

  it('keeps Save disabled until the name is non-blank and a type is chosen', async () => {
    setup()
    const save = await screen.findByRole('button', { name: 'Create gym' })
    expect(save).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Gym name'), '   ')
    expect(save).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Gym name'), 'Pewter')
    expect(save).toBeDisabled() // no type yet
  })

  it('offers all 18 types', async () => {
    setup()
    await userEvent.click(await screen.findByRole('combobox', { name: 'Gym type' }))
    expect(await screen.findAllByRole('option')).toHaveLength(POKE_TYPES.length)
  })

  it('creates a gym with a trimmed name and shows it in the list', async () => {
    const { api, create } = setup()
    await userEvent.type(await screen.findByLabelText('Gym name'), '  Pewter Gym  ')
    await userEvent.click(screen.getByRole('combobox', { name: 'Gym type' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Rock' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create gym' }))
    expect(await screen.findByText('Pewter Gym')).toBeInTheDocument()
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith({ name: 'Pewter Gym', type: 'Rock' })
    expect(api.notices).toEqual([{ message: 'Created Pewter Gym.', type: 'success' }])
    expect(screen.getByLabelText('Gym name')).toHaveValue('')
  })

  it('shows an error and no success notice when creating fails', async () => {
    const { api, create } = setup()
    create.mockRejectedValueOnce(new Error('boom'))
    await userEvent.type(await screen.findByLabelText('Gym name'), 'Pewter')
    await userEvent.click(screen.getByRole('combobox', { name: 'Gym type' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Rock' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create gym' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(api.notices.filter((n) => n.type === 'success')).toEqual([])
  })

  it('shows an empty state when there are no gyms', async () => {
    const api = new MockGameApi()
    api.listGyms = async () => []
    renderTab(api, (gyms, reload) => <GymsTab gyms={gyms} reload={reload} />)
    expect(await screen.findByText('No gyms yet')).toBeInTheDocument()
    expect(screen.getByLabelText('Gym name')).toBeInTheDocument()
  })
})
