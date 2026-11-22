import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { MockGameApi } from '../../api/mock/MockGameApi'
import { GymHQ } from './GymHQ'

afterEach(() => document.documentElement.classList.remove('dark'))

async function setup(theme: 'light' | 'dark') {
  const api = new MockGameApi({ context: { theme } })
  await api.setBoardConfig({ gymsBoardId: 'b1', pokemonBoardId: 'b2' })
  const gyms = vi.spyOn(api, 'listGyms')
  render(<ApiProvider api={api}><GymHQ /></ApiProvider>)
  return { gyms }
}

describe('GymHQ', () => {
  it('loads gyms from the configured gyms board and shows the tabs', async () => {
    const { gyms } = await setup('light')
    expect(await screen.findByRole('tab', { name: 'Gyms' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Recruit' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Arena' })).toBeInTheDocument()
    expect(gyms).toHaveBeenCalledWith({ boardIds: ['b1'] })
    expect(await screen.findByText('Cinnabar Gym')).toBeInTheDocument()
    expect(document.documentElement).not.toHaveClass('dark')
  })

  it('applies the dark class from the context theme', async () => {
    await setup('dark')
    await screen.findByRole('tab', { name: 'Gyms' })
    expect(document.documentElement).toHaveClass('dark')
  })
})

describe('GymHQ — Connect tab', () => {
  it('has a Connect tab next to the game tabs', async () => {
    await setup('light')
    expect(await screen.findByRole('tab', { name: 'Connect' })).toBeInTheDocument()
  })
})
