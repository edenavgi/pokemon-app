import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { MockGameApi } from '../../api/mock/MockGameApi'
import { Widget } from './Widget'

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { warn.mockRestore() })

async function setup(widgetBoardIds: string[] | undefined, configure = true) {
  const api = new MockGameApi({ context: { widgetBoardIds } })
  if (configure) await api.setBoardConfig({ gymsBoardId: 'b1', pokemonBoardId: 'b2' })
  const gyms = vi.spyOn(api, 'listGyms')
  const pokemon = vi.spyOn(api, 'listPokemon')
  render(<ApiProvider api={api}><Widget /></ApiProvider>)
  return { api, gyms, pokemon }
}

const row = (name: string) => screen.getByRole('row', { name: new RegExp(name) })

describe('Widget', () => {
  it('both boards: per-gym table and per-status counts', async () => {
    const { gyms, pokemon } = await setup(['b1', 'b2'])
    await screen.findByText('Cinnabar Gym')
    expect(gyms).toHaveBeenCalledWith({ boardIds: ['b1'] })
    expect(pokemon).toHaveBeenCalledWith({ boardIds: ['b2'] })
    expect(within(row('Cinnabar Gym')).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Cinnabar Gym', '2', '11.5'])
    expect(within(row('Celadon Gym')).getAllByRole('cell').map((c) => c.textContent)).toEqual(['Celadon Gym', '6', '14.5'])
    const status = screen.getByRole('list', { name: 'By status' })
    expect(within(status).getAllByRole('listitem').map((i) => i.textContent)).toEqual(['Recruited2', 'Training3', 'Ready8', 'Resting2'])
    expect(screen.queryByText('Connect the Pokémon board to see status')).not.toBeInTheDocument()
  })

  it('gyms board only: table plus hint, no status', async () => {
    const { gyms, pokemon } = await setup(['b1'])
    await screen.findByText('Cinnabar Gym')
    expect(gyms).toHaveBeenCalledWith({ boardIds: ['b1'] })
    expect(pokemon).not.toHaveBeenCalled()
    expect(screen.getByText('Connect the Pokémon board to see status')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'By status' })).not.toBeInTheDocument()
  })

  it('pokemon board only: full data grouped from the Pokémon', async () => {
    const { gyms, pokemon } = await setup(['b2'])
    await screen.findByText('Cinnabar Gym')
    expect(pokemon).toHaveBeenCalledWith({ boardIds: ['b2'] })
    expect(gyms).not.toHaveBeenCalled()
    expect(within(row('No gym')).getAllByRole('cell').map((c) => c.textContent)).toEqual(['No gym', '5', '16.0'])
    expect(screen.getByRole('list', { name: 'By status' })).toBeInTheDocument()
    expect(screen.queryByText('Connect the Pokémon board to see status')).not.toBeInTheDocument()
  })

  it('ignores board ids that match neither configured board', async () => {
    const { gyms, pokemon } = await setup(['zzz'])
    expect(await screen.findByText('Connect the Gyms and/or Pokémon board in widget settings')).toBeInTheDocument()
    expect(gyms).not.toHaveBeenCalled()
    expect(pokemon).not.toHaveBeenCalled()
  })

  it('shows Empty when no board is connected', async () => {
    await setup(undefined)
    expect(await screen.findByText('Connect the Gyms and/or Pokémon board in widget settings')).toBeInTheDocument()
  })

  it('shows BoardSetup when there is no config', async () => {
    const { gyms } = await setup(['b1'], false)
    expect(await screen.findByRole('button', { name: /save/i })).toBeInTheDocument()
    expect(gyms).not.toHaveBeenCalled()
  })

  it('rounds the average to 1 decimal and shows a dash for an empty gym', async () => {
    const api = new MockGameApi({ context: { widgetBoardIds: ['b1'] } })
    await api.setBoardConfig({ gymsBoardId: 'b1', pokemonBoardId: 'b2' })
    api.listGyms = async () => [
      { id: 'g1', name: 'Odd Gym', type: 'Fire', roster: [], mirroredLevels: [5, 6, 6] },
      { id: 'g2', name: 'Empty Gym', type: 'Rock', roster: [], mirroredLevels: [] },
    ]
    render(<ApiProvider api={api}><Widget /></ApiProvider>)
    await screen.findByText('Odd Gym')
    expect(within(row('Odd Gym')).getAllByRole('cell')[2]).toHaveTextContent('5.7')
    expect(within(row('Empty Gym')).getAllByRole('cell')[2]).toHaveTextContent('—')
  })

  it('shows a readable error with Retry when loading fails', async () => {
    const api = new MockGameApi({ context: { widgetBoardIds: ['b1'] } })
    await api.setBoardConfig({ gymsBoardId: 'b1', pokemonBoardId: 'b2' })
    api.listGyms = () => { throw new Error('listGyms: not implemented yet') }
    render(<ApiProvider api={api}><Widget /></ApiProvider>)
    expect(await screen.findByText(/listGyms: not implemented yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
