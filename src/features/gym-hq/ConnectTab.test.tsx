import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { MockGameApi } from '../../api/mock/MockGameApi'
import { connectText as t } from '../../lib/messages'
import { CONNECT_MAX_WAIT_MS, CONNECT_POLL_MS, ConnectTab } from './ConnectTab'

const cfg = { gymsBoardId: 'b1', pokemonBoardId: 'b2' }

// Short timings so the polling tests finish fast; the real values are checked separately.
function setup(server: Partial<MockGameApi['serverStatus']> = {}, timing = { pollMs: 20, maxWaitMs: 200 }) {
  const api = new MockGameApi()
  Object.assign(api.serverStatus, server)
  const status = vi.spyOn(api, 'getServerStatus')
  const sync = vi.spyOn(api, 'syncBoardConfig')
  render(<ApiProvider api={api}><ConnectTab cfg={cfg} {...timing} /></ApiProvider>)
  return { api, status, sync }
}

describe('ConnectTab', () => {
  it('polls every 2 s for at most 2 minutes', () => {
    expect(CONNECT_POLL_MS).toBe(2000)
    expect(CONNECT_MAX_WAIT_MS).toBe(120_000)
  })

  it('not connected → shows Connect to monday, Connect Telegram is disabled', async () => {
    setup()
    expect(await screen.findByRole('button', { name: t.connectMonday })).toBeEnabled()
    expect(screen.getByText(t.notConnected)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.connectTelegram })).toBeDisabled()
  })

  it('click Connect → startMondayOAuth, then polls status until connected', async () => {
    const { api, status } = setup()
    await userEvent.click(await screen.findByRole('button', { name: t.connectMonday }))

    expect(api.oauthStarts).toBe(1)
    expect(await screen.findByText(t.waiting)).toBeInTheDocument()
    await waitFor(() => expect(status.mock.calls.length).toBeGreaterThan(2)) // still polling

    Object.assign(api.serverStatus, { connected: true, boardsKnown: true })
    expect(await screen.findByText(t.connected)).toBeInTheDocument()

    const calls = status.mock.calls.length
    await new Promise((r) => setTimeout(r, 80))
    expect(status.mock.calls.length).toBe(calls) // polling stopped
  })

  it('gives up after the max wait and offers Connect again', async () => {
    const { status } = setup()
    await userEvent.click(await screen.findByRole('button', { name: t.connectMonday }))
    expect(await screen.findByText(t.timedOut, {}, { timeout: 1000 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.connectMonday })).toBeEnabled()

    const calls = status.mock.calls.length
    await new Promise((r) => setTimeout(r, 80))
    expect(status.mock.calls.length).toBe(calls)
  })

  it('shows an error when the server cannot be started for OAuth', async () => {
    const { api } = setup()
    vi.spyOn(api, 'startMondayOAuth').mockRejectedValueOnce(new Error('Server down'))
    await userEvent.click(await screen.findByRole('button', { name: t.connectMonday }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Server down')
    expect(screen.getByRole('button', { name: t.connectMonday })).toBeEnabled()
  })

  it('connected and boards unknown → calls syncBoardConfig once with the saved config', async () => {
    const { sync } = setup({ connected: true, boardsKnown: false })
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(1))
    expect(sync).toHaveBeenCalledWith(cfg)
    expect(await screen.findByText(t.boardsSynced)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(sync).toHaveBeenCalledTimes(1)
  })

  it('connected with boards known → no sync', async () => {
    const { sync } = setup({ connected: true, boardsKnown: true })
    expect(await screen.findByText(t.connected)).toBeInTheDocument()
    expect(sync).not.toHaveBeenCalled()
  })

  it('connected → Connect Telegram enabled', async () => {
    setup({ connected: true, boardsKnown: true })
    expect(await screen.findByRole('button', { name: t.connectTelegram })).toBeEnabled()
  })

  it('a status error shows Retry, which loads again', async () => {
    const api = new MockGameApi()
    vi.spyOn(api, 'getServerStatus').mockRejectedValueOnce(new Error('Could not reach the server')) // before the first load
    render(<ApiProvider api={api}><ConnectTab cfg={cfg} pollMs={20} maxWaitMs={200} /></ApiProvider>)
    expect(await screen.findByText('Could not reach the server')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('button', { name: t.connectMonday })).toBeInTheDocument()
  })

  it('checks again at once when the user comes back to the tab (no wait for the next poll)', async () => {
    const { api } = setup({}, { pollMs: 60_000, maxWaitMs: 120_000 }) // polling won't fire during the test
    await userEvent.click(await screen.findByRole('button', { name: t.connectMonday }))
    expect(await screen.findByText(t.waiting)).toBeInTheDocument()

    Object.assign(api.serverStatus, { connected: true, boardsKnown: true })
    window.dispatchEvent(new Event('focus'))
    expect(await screen.findByText(t.connected)).toBeInTheDocument()
  })

  it('after giving up, coming back to the tab still notices the connection', async () => {
    const { api } = setup()
    await userEvent.click(await screen.findByRole('button', { name: t.connectMonday }))
    expect(await screen.findByText(t.timedOut, {}, { timeout: 1000 })).toBeInTheDocument()

    Object.assign(api.serverStatus, { connected: true, boardsKnown: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(await screen.findByText(t.connected)).toBeInTheDocument()
  })
})
