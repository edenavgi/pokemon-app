import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { MockGameApi } from '../../api/mock/MockGameApi'
import { joinErrorText, selectionText } from '../../lib/messages'
import { TransferAction } from './TransferAction'

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { warn.mockRestore() })

async function setup(selectedItemIds: string[] | undefined, tweak?: (api: MockGameApi) => void, boardId?: string) {
  const api = new MockGameApi({ context: { selectedItemIds, boardId } })
  await api.setBoardConfig({ gymsBoardId: 'b1', pokemonBoardId: 'b2' })
  tweak?.(api)
  const setGym = vi.spyOn(api, 'setGym')
  const gyms = vi.spyOn(api, 'listGyms')
  const close = vi.spyOn(api, 'closeFeature')
  render(<ApiProvider api={api}><TransferAction /></ApiProvider>)
  return { api, setGym, gyms, close }
}

const gymButton = (name: string) => screen.getByRole('button', { name: new RegExp(name) })

describe('TransferAction', () => {
  it('lists gyms except the shared current one; invalid gyms are disabled with a reason', async () => {
    const { gyms } = await setup(['p1', 'p2'])
    await screen.findByText('Cerulean Gym')
    expect(gyms).toHaveBeenCalledWith({ boardIds: ['b1'] })
    expect(screen.queryByRole('button', { name: /Cinnabar Gym/ })).not.toBeInTheDocument()
    expect(gymButton('Cerulean Gym')).toBeDisabled()
    expect(gymButton('Celadon Gym')).toBeDisabled()
    expect(screen.getAllByText(joinErrorText('TYPE_MISMATCH', ['Charmander', 'Charmeleon'])).length).toBeGreaterThan(0)
  })

  it('choosing a valid gym moves the Pokémon, notifies and closes', async () => {
    const { api, setGym, close } = await setup(['p13'], (a) => {
      const orig = a.listGyms.bind(a)
      a.listGyms = async (o) => [...(await orig(o)), { id: 'g2', name: 'Mind Gym', type: 'Psychic', roster: [], mirroredLevels: [] }]
    })
    await userEvent.click(await screen.findByRole('button', { name: /Mind Gym/ }))
    expect(setGym).toHaveBeenCalledTimes(1)
    expect(setGym).toHaveBeenCalledWith(['p13'], 'g2')
    await waitFor(() => expect(api.notices).toEqual([{ message: 'Moved Abra to Mind Gym.', type: 'success' }]))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('sends only the Pokémon not already in the chosen gym', async () => {
    const { api, setGym } = await setup(['p1', 'p2'], (a) => {
      const orig = a.listGyms.bind(a)
      a.listGyms = async (o) => {
        const p1 = (await orig(o)).find((g) => g.id === 'g1')!.roster.find((p) => p.id === 'p1')!
        return [{ id: 'gf', name: 'Fire Hall', type: 'Fire', roster: [p1], mirroredLevels: [] }]
      }
      a.setGym = async () => {} // the fake gym does not exist in the mock store
    })
    await userEvent.click(await screen.findByRole('button', { name: /Fire Hall/ }))
    expect(setGym).toHaveBeenCalledTimes(1)
    expect(setGym).toHaveBeenCalledWith(['p2'], 'gf')
    await waitFor(() => expect(api.notices).toEqual([{ message: 'Moved Charmeleon to Fire Hall.', type: 'success' }]))
  })

  it('everything already there: info "Nothing to move", no write', async () => {
    const { api, setGym, close } = await setup(['p1', 'p3'], (a) => {
      const orig = a.listGyms.bind(a)
      a.listGyms = async (o) => {
        const gyms = await orig(o)
        const p1 = gyms.find((g) => g.id === 'g1')!.roster.find((p) => p.id === 'p1')!
        const p3 = gyms.find((g) => g.id === 'g2')!.roster.find((p) => p.id === 'p3')!
        return [{ id: 'gf', name: 'Fire Hall', type: 'Fire', roster: [p1, p3], mirroredLevels: [] }]
      }
    })
    await userEvent.click(await screen.findByRole('button', { name: /Fire Hall/ }))
    expect(setGym).not.toHaveBeenCalled()
    await waitFor(() => expect(api.notices).toEqual([{ message: 'Nothing to move', type: 'info' }]))
    expect(close).not.toHaveBeenCalled()
  })

  it('a batch that overflows the roster: disabled with the reason, no write', async () => {
    const { api, setGym } = await setup(['p1', 'p2'], (a) => {
      const orig = a.listGyms.bind(a)
      a.listGyms = async (o) => {
        const gyms = await orig(o)
        const five = gyms.find((g) => g.id === 'g3')!.roster.slice(0, 5)
        return [{ id: 'gf', name: 'Almost Full', type: 'Fire', roster: five, mirroredLevels: [] }]
      }
    })
    const btn = await screen.findByRole('button', { name: /Almost Full/ })
    expect(btn).toBeDisabled()
    expect(screen.getByText(joinErrorText('ROSTER_FULL'))).toBeInTheDocument()
    await userEvent.click(btn)
    expect(setGym).not.toHaveBeenCalled()
    expect(api.notices).toEqual([])
  })

  it('write failure: shows the error, notifies, stays open', async () => {
    const { api, close } = await setup(['p13'], (a) => {
      const orig = a.listGyms.bind(a)
      a.listGyms = async (o) => [...(await orig(o)), { id: 'g2', name: 'Mind Gym', type: 'Psychic', roster: [], mirroredLevels: [] }]
      a.setGym = async () => { throw new Error('monday said no') }
    })
    await userEvent.click(await screen.findByRole('button', { name: /Mind Gym/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('monday said no')
    await waitFor(() => expect(api.notices).toEqual([{ message: 'monday said no', type: 'error' }]))
    expect(close).not.toHaveBeenCalled()
  })

  it('missing id from monday: rejects, no write', async () => {
    const { api, setGym } = await setup(['p1', 'p2'], (a) => {
      const orig = a.getPokemonMany.bind(a)
      a.getPokemonMany = async (ids) => (await orig(ids)).filter((p) => p.id !== 'p2')
    })
    expect(await screen.findByText(selectionText.notLoaded)).toBeInTheDocument()
    await waitFor(() => expect(api.notices).toEqual([{ message: selectionText.notLoaded, type: 'error' }]))
    expect(screen.queryByRole('button', { name: /Gym/ })).not.toBeInTheDocument()
    expect(setGym).not.toHaveBeenCalled()
  })

  it('duplicate ids: rejects with the DUPLICATE text and requests unique ids', async () => {
    const { api, setGym } = await setup(['p13', 'p13'], (a) => {
      const orig = a.getPokemonMany.bind(a)
      a.getPokemonMany = vi.fn(orig)
    })
    const text = joinErrorText('DUPLICATE', ['Abra'])
    expect(await screen.findByText(text)).toBeInTheDocument()
    await waitFor(() => expect(api.notices).toEqual([{ message: text, type: 'error' }]))
    expect(api.getPokemonMany).toHaveBeenCalledWith(['p13'])
    expect(setGym).not.toHaveBeenCalled()
  })

  it('wrong board: rejects, no gym buttons, no write', async () => {
    const { api, setGym, gyms } = await setup(['p1'], undefined, 'other')
    expect(await screen.findByText(selectionText.wrongBoard)).toBeInTheDocument()
    await waitFor(() => expect(api.notices).toEqual([{ message: selectionText.wrongBoard, type: 'error' }]))
    expect(screen.queryByRole('button', { name: /Gym/ })).not.toBeInTheDocument()
    expect(gyms).not.toHaveBeenCalled()
    expect(setGym).not.toHaveBeenCalled()
  })

  it('no selection: Empty hint, no gyms loaded', async () => {
    const { gyms } = await setup(undefined)
    expect(await screen.findByText('Select Pokémon on the board first')).toBeInTheDocument()
    expect(gyms).not.toHaveBeenCalled()
  })

  it('shows BoardSetup when there is no config', async () => {
    const api = new MockGameApi({ context: { selectedItemIds: ['p1'] } })
    render(<ApiProvider api={api}><TransferAction /></ApiProvider>)
    expect(await screen.findByRole('button', { name: /save/i })).toBeInTheDocument()
  })
})
