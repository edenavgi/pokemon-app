import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { MockGameApi, type MockOptions } from '../../api/mock/MockGameApi'
import { buildTalkPrompt } from '../../game/talk'
import { ItemView } from './ItemView'

function setup(opts: MockOptions = { context: { itemId: 'p1' } }) {
  const api = new MockGameApi(opts)
  render(<ApiProvider api={api}><ItemView /></ApiProvider>)
  return api
}

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { warn.mockRestore() })

describe('ItemView', () => {
  it('renders the profile for the context item', async () => {
    const api = setup()
    const p = await api.getPokemon('p1')
    expect(await screen.findByRole('heading', { name: p.name })).toBeInTheDocument()
    expect(screen.getByAltText(p.name)).toBeInTheDocument()
    expect(screen.getByText('#4')).toBeInTheDocument()
    expect(screen.getByText('Fire')).toBeInTheDocument()
    expect(screen.getByText(p.status)).toBeInTheDocument()
    expect(screen.getByText('Level').nextElementSibling).toHaveTextContent('5')
    expect(screen.getByText(/3 \/ 3/)).toBeInTheDocument()
    expect(screen.getByText(p.gym!.name)).toBeInTheDocument()
    for (const l of ['HP', 'Attack', 'Defense', 'Speed']) expect(screen.getByLabelText(l)).toBeInTheDocument()
  })

  it('shows updates from onItemChanged without user action', async () => {
    const api = setup()
    await screen.findByText('Charmander')
    await act(async () => { await api.updatePokemon([{ id: 'p1', patch: { level: 9 } }]) })
    await waitFor(() => expect(screen.getByText('Level').nextElementSibling).toHaveTextContent('9'))
  })

  it('shows Empty without an itemId', async () => {
    setup({ context: {} })
    expect(await screen.findByText('Open this view inside a Pokémon item')).toBeInTheDocument()
  })

  it('Talk sends the prompt built from the species and shows the reply', async () => {
    const user = userEvent.setup()
    const api = setup()
    const talk = vi.spyOn(api, 'talk')
    await user.click(await screen.findByRole('button', { name: 'Talk' }))
    const expected = buildTalkPrompt(await api.getSpecies(4))
    expect(await screen.findByTestId('speech-bubble')).toBeInTheDocument()
    expect(talk).toHaveBeenCalledWith(expected)
    const reply = await talk.mock.results[0].value
    expect(within(screen.getByTestId('speech-bubble')).getByText(reply)).toBeInTheDocument()
  })

  it('disables the button while waiting', async () => {
    const user = userEvent.setup()
    setup({ context: { itemId: 'p1' }, delayMs: 20 })
    await user.click(await screen.findByRole('button', { name: 'Talk' }))
    expect(screen.getByRole('button', { name: /talking/i })).toBeDisabled()
    await screen.findByTestId('speech-bubble')
    expect(screen.getByRole('button', { name: 'Talk' })).toBeEnabled()
  })

  it('shows a friendly fallback, not the raw error, when talk fails', async () => {
    const user = userEvent.setup()
    setup({ context: { itemId: 'p1' }, failTalk: true })
    await user.click(await screen.findByRole('button', { name: 'Talk' }))
    expect(await screen.findByText('Charmander is napping right now. Try again later.')).toBeInTheDocument()
    expect(screen.queryByText(/run_prompt failed/)).not.toBeInTheDocument()
    expect(warn).toHaveBeenCalled()
  })

  it('uses the new species for Talk after evolution', async () => {
    const user = userEvent.setup()
    const api = setup()
    const talk = vi.spyOn(api, 'talk')
    await user.click(await screen.findByRole('button', { name: 'Talk' }))
    await screen.findByTestId('speech-bubble')
    await act(async () => { await api.updatePokemon([{ id: 'p1', patch: { name: 'Charmeleon', dexNumber: 5 } }]) })
    await screen.findByRole('heading', { name: 'Charmeleon' })
    await waitFor(() => expect(screen.queryByTestId('speech-bubble')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Talk' }))
    await screen.findByTestId('speech-bubble')
    expect(talk).toHaveBeenLastCalledWith(buildTalkPrompt(await api.getSpecies(5)))
  })

  it('ignores a late reply after the Pokémon evolved', async () => {
    const user = userEvent.setup()
    const api = setup()
    let resolve!: (v: string) => void
    vi.spyOn(api, 'talk').mockReturnValue(new Promise<string>((r) => { resolve = r }))
    await user.click(await screen.findByRole('button', { name: 'Talk' }))
    await screen.findByRole('button', { name: /talking/i })
    await act(async () => { await api.updatePokemon([{ id: 'p1', patch: { name: 'Charmeleon', dexNumber: 5 } }]) })
    await screen.findByRole('heading', { name: 'Charmeleon' })
    await act(async () => { resolve('stale hello') })
    expect(screen.queryByText('stale hello')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Talk' })).toBeEnabled()
  })
})
