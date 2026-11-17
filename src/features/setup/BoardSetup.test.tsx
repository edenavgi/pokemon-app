import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { MockGameApi } from '../../api/mock/MockGameApi'
import { RequireBoardConfig } from './RequireBoardConfig'

function setup(api = new MockGameApi()) {
  render(
    <ApiProvider api={api}>
      <RequireBoardConfig>{(cfg) => <p>configured {cfg.gymsBoardId}/{cfg.pokemonBoardId}</p>}</RequireBoardConfig>
    </ApiProvider>,
  )
  return api
}

describe('RequireBoardConfig / BoardSetup', () => {
  it('renders children straight away when already configured', async () => {
    const api = new MockGameApi()
    await api.setBoardConfig({ gymsBoardId: 'b1', pokemonBoardId: 'b2' })
    setup(api)
    expect(await screen.findByText('configured b1/b2')).toBeInTheDocument()
  })

  it('enables Save only when both boards are chosen and differ, then saves', async () => {
    const user = userEvent.setup()
    const api = new MockGameApi()
    const spy = vi.spyOn(api, 'setBoardConfig')
    setup(api)
    const gyms = await screen.findByLabelText('Gyms board')
    const pokemon = screen.getByLabelText('Pokémon board')
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    await user.selectOptions(gyms, 'b1')
    expect(save).toBeDisabled()
    await user.selectOptions(pokemon, 'b1')
    expect(save).toBeDisabled()
    await user.selectOptions(pokemon, 'b2')
    expect(save).toBeEnabled()

    await user.click(save)
    expect(spy).toHaveBeenCalledWith({ gymsBoardId: 'b1', pokemonBoardId: 'b2' })
    expect(await screen.findByText('configured b1/b2')).toBeInTheDocument()
  })

  it('disables Save while saving (no double submit)', async () => {
    const user = userEvent.setup()
    const api = new MockGameApi()
    let release!: () => void
    const spy = vi.spyOn(api, 'setBoardConfig').mockImplementation(() => new Promise<void>((r) => { release = r }))
    setup(api)
    await user.selectOptions(await screen.findByLabelText('Gyms board'), 'b1')
    await user.selectOptions(screen.getByLabelText('Pokémon board'), 'b2')
    const save = screen.getByRole('button', { name: 'Save' })
    await user.click(save)
    await waitFor(() => expect(save).toBeDisabled())
    await user.click(save)
    expect(spy).toHaveBeenCalledTimes(1)
    release()
  })
})
