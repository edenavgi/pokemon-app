import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { MockGameApi, type MockOptions } from '../../api/mock/MockGameApi'
import { BoardView } from './BoardView'

// jsdom lacks these; Radix Select calls them when opening.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { warn.mockRestore() })

function setup(opts: MockOptions = { context: { boardId: 'b1' } }, prepare?: (api: MockGameApi) => void) {
  const api = new MockGameApi(opts)
  prepare?.(api)
  const spy = vi.spyOn(api, 'listGyms')
  render(<ApiProvider api={api}><BoardView /></ApiProvider>)
  return { api, spy }
}

describe('BoardView', () => {
  it('passes the context boardId to listGyms', async () => {
    const { spy } = setup()
    await screen.findByText('Charmander')
    expect(spy).toHaveBeenCalledWith({ boardIds: ['b1'] })
  })

  it('calls listGyms without arguments when the context has no boardId', async () => {
    const { spy } = setup({ context: {} })
    await screen.findByText('Charmander')
    expect(spy).toHaveBeenCalledWith()
  })

  it('selects the first gym and shows its roster cards', async () => {
    setup()
    expect(await screen.findByRole('combobox', { name: 'Gym' })).toHaveTextContent('Cinnabar Gym')
    expect(screen.getByText('Charmander')).toBeInTheDocument()
    expect(screen.getByAltText('Charmander')).toBeInTheDocument()
    expect(screen.getByText('Lv. 5')).toBeInTheDocument()
    expect(screen.getByText('Charmeleon')).toBeInTheDocument()
    expect(screen.queryByText('Squirtle')).not.toBeInTheDocument()
  })

  it('switches gym through the Select', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(await screen.findByRole('combobox', { name: 'Gym' }))
    await user.click(await screen.findByRole('option', { name: 'Cerulean Gym' }))
    expect(await screen.findByText('Squirtle')).toBeInTheDocument()
    expect(screen.queryByText('Charmander')).not.toBeInTheDocument()
  })

  it('offers All plus the four statuses, All pressed by default', async () => {
    setup()
    await screen.findByText('Charmander')
    const group = screen.getByRole('group', { name: 'Filter by status' })
    const names = within(group).getAllByRole('button').map((b) => b.textContent)
    expect(names).toEqual(['All', 'Recruited', 'Training', 'Ready', 'Resting'])
    expect(within(group).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('choosing Ready hides the other statuses', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByText('Charmeleon')
    await user.click(screen.getByRole('button', { name: 'Ready' }))
    expect(screen.getByRole('button', { name: 'Ready' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Charmander')).toBeInTheDocument()
    expect(screen.queryByText('Charmeleon')).not.toBeInTheDocument()
  })

  it('shows Empty when the filter matches nothing', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByText('Charmander')
    await user.click(screen.getByRole('button', { name: 'Recruited' }))
    expect(screen.getByText('No Pokémon with this status')).toBeInTheDocument()
  })

  it('keeps the status filter when the gym changes', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByText('Charmander')
    await user.click(screen.getByRole('button', { name: 'Ready' }))
    await user.click(screen.getByRole('combobox', { name: 'Gym' }))
    await user.click(await screen.findByRole('option', { name: 'Cerulean Gym' }))
    expect(await screen.findByText('Squirtle')).toBeInTheDocument()
    expect(screen.queryByText('Wartortle')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ready' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows Empty for a gym with an empty roster', async () => {
    const user = userEvent.setup()
    setup({ context: { boardId: 'b1' } }, (api) => { void api.createGym({ name: 'Pewter Gym', type: 'Rock' }) })
    await user.click(await screen.findByRole('combobox', { name: 'Gym' }))
    await user.click(await screen.findByRole('option', { name: 'Pewter Gym' }))
    expect(await screen.findByText('No Pokémon in this gym yet')).toBeInTheDocument()
  })

  it('shows Empty when the board has no gyms', async () => {
    const api = new MockGameApi({ context: { boardId: 'b1' } })
    api.listGyms = async () => []
    render(<ApiProvider api={api}><BoardView /></ApiProvider>)
    expect(await screen.findByText('No gyms on this board yet')).toBeInTheDocument()
  })

  it('shows a readable error with Retry when listGyms fails', async () => {
    const api = new MockGameApi({ context: { boardId: 'b1' } })
    api.listGyms = () => { throw new Error('listGyms: not implemented yet') }
    render(<ApiProvider api={api}><BoardView /></ApiProvider>)
    expect(await screen.findByText(/listGyms: not implemented yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
