import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import type { Status } from '../../api/GameApi'
import { MockGameApi } from '../../api/mock/MockGameApi'
import { evoBlockText, statusDialogText as t } from '../../lib/messages'
import { StatusDialog } from './StatusDialog'

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { warn.mockRestore() })

async function setup(itemId: string | undefined, patch?: { level?: number; status?: Status; energy?: number }) {
  const api = new MockGameApi({ context: { itemId } })
  if (itemId && patch) await api.updatePokemon([{ id: itemId, patch }])
  const update = vi.spyOn(api, 'updatePokemon')
  const close = vi.spyOn(api, 'closeFeature')
  const post = vi.spyOn(api, 'postUpdate')
  render(<ApiProvider api={api}><StatusDialog /></ApiProvider>)
  return { api, update, close, post }
}

const buttonNames = () => screen.getAllByRole('button').map((b) => b.textContent)

describe('StatusDialog transitions', () => {
  it.each([
    ['Recruited', 1, ['Training']],
    ['Training', 4, ['Resting']],
    ['Training', 5, ['Ready', 'Resting']],
    ['Ready', 5, ['Training', 'Resting']],
  ] as const)('%s at level %i offers %j', async (status, level, to) => {
    const { update, close, api } = await setup('p1', { status, level })
    await screen.findByText(new RegExp(`Lv. ${level}`))
    expect(buttonNames().filter((n) => n !== t.evolve)).toEqual(to.map(t.moveTo))
    await userEvent.click(screen.getByRole('button', { name: t.moveTo(to[0]) }))
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenLastCalledWith([{ id: 'p1', patch: { status: to[0] } }])
    expect(api.notices.at(-1)?.type).toBe('success')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('Resting: single Rest button, Training below level 5', async () => {
    const { update, close } = await setup('p1', { status: 'Resting', energy: 0, level: 4 })
    await screen.findByText(/Lv. 4/)
    expect(buttonNames().filter((n) => n !== t.evolve)).toEqual([t.rest])
    await userEvent.click(screen.getByRole('button', { name: t.rest }))
    expect(update).toHaveBeenLastCalledWith([{ id: 'p1', patch: { energy: 3, status: 'Training' } }])
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('Resting at level 5+: Rest sets Ready', async () => {
    const { update } = await setup('p1', { status: 'Resting', energy: 0, level: 5 })
    await userEvent.click(await screen.findByRole('button', { name: t.rest }))
    expect(update).toHaveBeenLastCalledWith([{ id: 'p1', patch: { energy: 3, status: 'Ready' } }])
  })

  it('write failure: error shown, buttons stay, no close', async () => {
    const { api, close } = await setup('p1', { status: 'Ready', level: 5 })
    const button = await screen.findByRole('button', { name: t.moveTo('Resting') })
    vi.spyOn(api, 'updatePokemon').mockRejectedValue(new Error('boom'))
    await userEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(api.notices.at(-1)).toEqual({ message: 'boom', type: 'error' })
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: t.moveTo('Resting') })).toBeEnabled()
  })

  it('no itemId: empty state', async () => {
    await setup(undefined)
    expect(await screen.findByText(t.notInItem)).toBeInTheDocument()
  })
})

describe('StatusDialog evolve', () => {
  it('level 3 Charmander: Evolve button with preview', async () => {
    await setup('p1', { level: 3, status: 'Training' })
    expect(await screen.findByRole('button', { name: t.evolve })).toBeEnabled()
    expect(screen.getByText('→ Charmeleon')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Charmeleon' })).toBeInTheDocument()
  })

  it('level 2 Charmander: no Evolve, level hint', async () => {
    await setup('p1', { level: 2, status: 'Training' })
    expect(await screen.findByText(evoBlockText('LEVEL_TOO_LOW', 3))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.evolve })).not.toBeInTheDocument()
  })

  it.each([['p9', 'Pikachu', 'NO_LEVEL_EVOLUTION'], ['p14', 'Eevee', 'BRANCHING'], ['p11', 'Golbat', 'OUTSIDE_GEN1']] as const)(
    '%s %s: no Evolve button, hint %s',
    async (id, _name, reason) => {
      await setup(id)
      expect(await screen.findByText(evoBlockText(reason))).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: t.evolve })).not.toBeInTheDocument()
    },
  )

  it('Evolve: updates the item, posts the update, stays open as Charmeleon', async () => {
    const { api, update, post, close } = await setup('p1', { level: 3, status: 'Training' })
    await userEvent.click(await screen.findByRole('button', { name: t.evolve }))
    expect(await screen.findByText('Charmeleon', { selector: 'span' })).toBeInTheDocument()
    expect(update).toHaveBeenLastCalledWith([
      { id: 'p1', patch: expect.objectContaining({ name: 'Charmeleon', dexNumber: 5 }) },
    ])
    expect(post).toHaveBeenCalledWith('p1', 'Charmander evolved into Charmeleon')
    expect(api.notices.at(-1)).toEqual({ message: t.evolveSuccess('Charmander', 'Charmeleon'), type: 'success' })
    expect(close).not.toHaveBeenCalled()
    const p = await api.getPokemon('p1')
    expect(p).toMatchObject({ level: 3, status: 'Training', name: 'Charmeleon' })
    expect(p.gym?.id).toBe('g1')
    expect(await screen.findByText(/Lv. 3/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.evolve })).not.toBeInTheDocument()
  })

  it('Evolve write failure: error, postUpdate not called, dialog stays', async () => {
    const { api, post, close } = await setup('p1', { level: 3, status: 'Training' })
    const evolve = await screen.findByRole('button', { name: t.evolve })
    vi.spyOn(api, 'updatePokemon').mockRejectedValue(new Error('write failed'))
    await userEvent.click(evolve)
    expect(await screen.findByRole('alert')).toHaveTextContent('write failed')
    expect(post).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    expect(api.notices.at(-1)).toEqual({ message: 'write failed', type: 'error' })
  })

  it('stays locked while the reload is in flight: no double evolve or post', async () => {
    const { api, update, post } = await setup('p1', { level: 3, status: 'Training' })
    const evolve = await screen.findByRole('button', { name: t.evolve })
    const real = api.getPokemon.bind(api)
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    vi.spyOn(api, 'getPokemon').mockImplementation(async (id) => { await gate; return real(id) })
    await userEvent.click(evolve)
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    const stale = screen.queryByRole('button', { name: t.evolve })
    if (stale) { expect(stale).toBeDisabled(); await userEvent.click(stale) }
    expect(update).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledTimes(1)
    release()
    await screen.findByText('Charmeleon', { selector: 'span' })
    expect(update).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('no stale Evolve for the new form while its evolution info loads', async () => {
    const { api } = await setup('p1', { level: 3, status: 'Training' })
    const evolve = await screen.findByRole('button', { name: t.evolve })
    const real = api.getEvolution.bind(api)
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    vi.spyOn(api, 'getEvolution').mockImplementation(async (dex) => { if (dex === 5) await gate; return real(dex) })
    await userEvent.click(evolve)
    await screen.findByText('Charmeleon', { selector: 'span' })
    expect(screen.queryByRole('button', { name: t.evolve })).not.toBeInTheDocument()
    release()
    expect(await screen.findByText(evoBlockText('LEVEL_TOO_LOW', 6))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.evolve })).not.toBeInTheDocument()
  })

  it('postUpdate fails after the evolve: item stays evolved, error shown, no success notice', async () => {
    const { api, close } = await setup('p1', { level: 3, status: 'Training' })
    const evolve = await screen.findByRole('button', { name: t.evolve })
    vi.spyOn(api, 'postUpdate').mockRejectedValue(new Error('no post'))
    await userEvent.click(evolve)
    expect(await screen.findByRole('alert')).toHaveTextContent(t.updateFailed)
    expect(await screen.findByText('Charmeleon', { selector: 'span' })).toBeInTheDocument()
    expect((await api.getPokemon('p1')).name).toBe('Charmeleon')
    expect(api.notices.at(-1)).toEqual({ message: t.updateFailed, type: 'error' })
    expect(close).not.toHaveBeenCalled()
  })

  it('evolution load failure: note shown, status buttons still work', async () => {
    const api = new MockGameApi({ context: { itemId: 'p1' } })
    vi.spyOn(api, 'getEvolution').mockRejectedValue(new Error('pokeapi down'))
    const close = vi.spyOn(api, 'closeFeature')
    render(<ApiProvider api={api}><StatusDialog /></ApiProvider>)
    expect(await screen.findByText(t.evoLoadFailed)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.evolve })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t.moveTo('Training') }))
    expect(close).toHaveBeenCalledTimes(1)
  })
})
