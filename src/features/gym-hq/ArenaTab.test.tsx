import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { BattleView } from '../../api/GameApi'
import { MockGameApi } from '../../api/mock/MockGameApi'
import { ServerError } from '../../api/server/serverClient'
import { battleErrorText } from '../../lib/messages'
import { ARENA_MAX_WAIT_MS, ARENA_POLL_MS, ArenaTab } from './ArenaTab'
import { polyfillSelect, renderTab } from './testHarness'

beforeAll(polyfillSelect)

// Short real timers (as in ConnectTab.test): the defaults are asserted separately.
const FAST = { pollMs: 10, maxWaitMs: 300, stepMs: 1 }

const setup = (api = new MockGameApi({ battlePolls: 2 })) => {
  const reload = vi.fn()
  renderTab(api, (gyms) => <ArenaTab gyms={gyms} reload={reload} {...FAST} />)
  return { api, reload }
}

async function choose(label: string, name: string) {
  await userEvent.click(await screen.findByRole('combobox', { name: label }))
  await userEvent.click(await screen.findByRole('option', { name }))
}

async function fight(first = 'Cinnabar Gym', second = 'Cerulean Gym') {
  await choose('First gym', first)
  await choose('Second gym', second)
  await userEvent.click(screen.getByRole('button', { name: 'Battle' }))
}

describe('ArenaTab', () => {
  it('polls every 1.5 s for up to 2 minutes by default', () => {
    expect(ARENA_POLL_MS).toBe(1500)
    expect(ARENA_MAX_WAIT_MS).toBe(120_000)
  })

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

  it('Battle → startBattle, shows "Battle queued…", polls without turns, then loads the turns once and replays', async () => {
    const { api } = setup()
    const start = vi.spyOn(api, 'startBattle')
    const get = vi.spyOn(api, 'getBattle')
    await fight()
    expect(start).toHaveBeenCalledWith('g1', 'g2')
    expect(await screen.findByText('Battle queued…')).toBeInTheDocument()

    expect(await screen.findByRole('status')).toHaveTextContent(/wins!|draw/)
    const withoutTurns = get.mock.calls.filter(([, o]) => !o.turns)
    const withTurns = get.mock.calls.filter(([, o]) => o.turns)
    expect(withoutTurns.length).toBeGreaterThanOrEqual(2)
    expect(withTurns).toHaveLength(1)
    expect(within(screen.getByRole('log')).getAllByRole('listitem').length).toBeGreaterThan(0)
  })

  it('no longer writes to the board (the server does), and reloads the gyms when the battle is done', async () => {
    const { api, reload } = setup()
    const update = vi.spyOn(api, 'updatePokemon')
    const post = vi.spyOn(api, 'postUpdate')
    await fight()
    await screen.findByRole('status')
    expect(update).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
    await waitFor(() => expect(reload).toHaveBeenCalled())
  })

  it.each(['SAME_GYM', 'A_NOT_ELIGIBLE', 'B_NOT_ELIGIBLE'] as const)('shows battleErrorText for a 400 %s', async (code) => {
    const { api } = setup()
    vi.spyOn(api, 'startBattle').mockRejectedValue(new ServerError(400, code))
    const get = vi.spyOn(api, 'getBattle')
    await fight()
    expect(await screen.findByRole('alert')).toHaveTextContent(battleErrorText(code))
    expect(get).not.toHaveBeenCalled()
  })

  it.each(['NOT_CONNECTED', 'NO_BOARDS'])('%s points to the Connect tab', async (code) => {
    const { api } = setup()
    vi.spyOn(api, 'startBattle').mockRejectedValue(new ServerError(409, code))
    await fight()
    expect(await screen.findByRole('alert')).toHaveTextContent('Connect tab')
  })

  it('shows the error when the battle failed on the server', async () => {
    const { api } = setup()
    vi.spyOn(api, 'getBattle').mockImplementation(async (id) => ({
      battle: { ...(await api.listBattles())[0], id, status: 'failed', error: 'QUOTA' } as BattleView,
    }))
    await fight()
    expect(await screen.findByRole('alert')).toHaveTextContent('QUOTA')
  })

  it('stops polling after the max wait with a retry message', async () => {
    const { api } = setup()
    const get = vi.spyOn(api, 'getBattle').mockImplementation(async (id) => ({
      battle: { id, source: 'app', status: 'queued', createdAt: '', gymA: { id: 'g1', name: 'Cinnabar Gym' }, gymB: { id: 'g2', name: 'Cerulean Gym' } },
    }))
    await fight()
    expect(await screen.findByRole('alert', {}, { timeout: 2000 })).toHaveTextContent('taking longer')
    const calls = get.mock.calls.length
    await new Promise((r) => setTimeout(r, 60))
    expect(get.mock.calls.length).toBe(calls)
    expect(screen.getByRole('button', { name: 'Battle' })).toBeEnabled() // can try again
  })

  it('lists recent battles, including a Telegram one, and replays one', async () => {
    const api = new MockGameApi({ battlePolls: 0 }) // already finished
    const { battleId } = await api.startBattle('g1', 'g2')
    api.markTelegram(battleId)
    const get = vi.spyOn(api, 'getBattle')
    setup(api)
    const list = await screen.findByRole('list', { name: 'Recent battles' })
    const row = within(list).getByRole('listitem')
    expect(row).toHaveTextContent('Cinnabar Gym vs Cerulean Gym')
    expect(row).toHaveTextContent('Telegram')
    await userEvent.click(within(row).getByRole('button', { name: 'Replay' }))
    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(get).toHaveBeenCalledWith(battleId, { turns: true })
  })

  it('shows an empty state with fewer than two gyms', async () => {
    const api = new MockGameApi()
    const orig = api.listGyms.bind(api)
    api.listGyms = async (o) => (await orig(o)).slice(0, 1)
    renderTab(api, (gyms) => <ArenaTab gyms={gyms} reload={() => {}} />)
    expect(await screen.findByText('Pick two different gyms to battle.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Battle' })).not.toBeInTheDocument()
  })
})
