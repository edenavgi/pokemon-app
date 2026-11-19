import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { MockGameApi } from '../../api/mock/MockGameApi'
import { selectionText, sparErrorText } from '../../lib/messages'
import { SparAction } from './SparAction'

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { warn.mockRestore() })

async function setup(selectedItemIds: string[] | undefined, tweak?: (api: MockGameApi) => void, boardId?: string) {
  const api = new MockGameApi({ context: { selectedItemIds, boardId } })
  await api.setBoardConfig({ gymsBoardId: 'b1', pokemonBoardId: 'b2' })
  tweak?.(api)
  const update = vi.spyOn(api, 'updatePokemon')
  const close = vi.spyOn(api, 'closeFeature')
  render(<ApiProvider api={api}><SparAction /></ApiProvider>)
  return { api, update, close }
}

describe('SparAction', () => {
  it('valid pair: shows before → after, confirms with one write', async () => {
    const { api, update, close } = await setup(['p1', 'p2'])
    const p1 = await screen.findByRole('listitem', { name: 'Charmander' })
    expect(within(p1).getByText('Level: 5 → 6')).toBeInTheDocument()
    expect(within(p1).getByText('Energy: 3 → 2')).toBeInTheDocument()
    const p2 = screen.getByRole('listitem', { name: 'Charmeleon' })
    expect(within(p2).getByText('Level: 18 → 19')).toBeInTheDocument()
    expect(within(p2).getByText('Energy: 2 → 1')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(update).toHaveBeenCalledTimes(1)
    const patches = update.mock.calls[0][0]
    expect(patches.map((x) => x.id)).toEqual(['p1', 'p2'])
    expect(patches[0].patch).toMatchObject({ level: 6, energy: 2 })
    expect(patches[1].patch).toMatchObject({ level: 19, energy: 1 })
    await waitFor(() => expect(api.notices).toEqual([{ message: 'Charmander and Charmeleon sparred: +1 level, -1 energy each.', type: 'success' }]))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['NEED_TWO', ['p1'], undefined],
    ['NEED_TWO', undefined, undefined],
    ['DUPLICATE', ['p1', 'p1'], undefined],
    ['NO_GYM', ['p11', 'p13'], ['Golbat', 'Abra']],
    ['DIFFERENT_GYMS', ['p1', 'p3'], undefined],
    ['RESTING', ['p3', 'p4'], ['Wartortle']],
  ] as const)('invalid %s: error notice, no Confirm, no write', async (code, ids, names) => {
    const { api, update, close } = await setup(ids ? [...ids] : undefined)
    const text = sparErrorText(code, names ? [...names] : undefined)
    expect(await screen.findByText(text)).toBeInTheDocument()
    await waitFor(() => expect(api.notices).toEqual([{ message: text, type: 'error' }]))
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('invalid NO_ENERGY: error notice, no Confirm, no write', async () => {
    const { api, update } = await setup(['p1', 'p2'], (a) => {
      const orig = a.getPokemonMany.bind(a)
      a.getPokemonMany = async (ids) => (await orig(ids)).map((p) => (p.id === 'p1' ? { ...p, energy: 0, status: 'Training' } : p))
    })
    const text = sparErrorText('NO_ENERGY', ['Charmander'])
    expect(await screen.findByText(text)).toBeInTheDocument()
    await waitFor(() => expect(api.notices).toEqual([{ message: text, type: 'error' }]))
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })

  it('write failure: shows the error, notifies, stays open and can retry', async () => {
    const { api, close } = await setup(['p1', 'p2'], (a) => {
      a.updatePokemon = async () => { throw new Error('monday said no') }
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('monday said no')
    await waitFor(() => expect(api.notices).toEqual([{ message: 'monday said no', type: 'error' }]))
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled()
  })

  it('rejects a selection that monday did not fully return (missing id)', async () => {
    const { api, update } = await setup(['p1', 'p2'], (a) => {
      const orig = a.getPokemonMany.bind(a)
      a.getPokemonMany = async (ids) => (await orig(ids)).filter((p) => p.id !== 'p2')
    })
    const text = selectionText.notLoaded
    expect(await screen.findByText(text)).toBeInTheDocument()
    await waitFor(() => expect(api.notices).toEqual([{ message: text, type: 'error' }]))
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })

  it('duplicate ids: DUPLICATE even when monday dedupes, asks for unique ids', async () => {
    const { api, update } = await setup(['p1', 'p1'])
    const text = sparErrorText('DUPLICATE')
    expect(await screen.findByText(text)).toBeInTheDocument()
    await waitFor(() => expect(api.notices).toEqual([{ message: text, type: 'error' }]))
    expect(update).not.toHaveBeenCalled()
  })

  it('wrong board: rejects without fetching or writing', async () => {
    const { api, update } = await setup(['p1', 'p2'], undefined, 'other')
    const get = vi.spyOn(api, 'getPokemonMany')
    expect(await screen.findByText(selectionText.wrongBoard)).toBeInTheDocument()
    await waitFor(() => expect(api.notices).toEqual([{ message: selectionText.wrongBoard, type: 'error' }]))
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(get).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('configured Pokémon board id is accepted', async () => {
    await setup(['p1', 'p2'], undefined, 'b2')
    expect(await screen.findByRole('button', { name: 'Confirm' })).toBeInTheDocument()
  })

  it('shows a readable error with Retry when loading fails', async () => {
    await setup(['p1', 'p2'], (a) => { a.getPokemonMany = () => { throw new Error('load broke') } })
    expect(await screen.findByText(/load broke/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
