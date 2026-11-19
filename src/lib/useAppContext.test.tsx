import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../api/ApiProvider'
import { MockGameApi } from '../api/mock/MockGameApi'
import { useAppContext } from './useAppContext'

describe('useAppContext', () => {
  it('loads context, follows changes, toggles the dark class and unsubscribes', async () => {
    const api = new MockGameApi()
    const wrapper = ({ children }: { children: ReactNode }) => <ApiProvider api={api}>{children}</ApiProvider>
    const { result, unmount } = renderHook(() => useAppContext(), { wrapper })
    expect(result.current).toBeUndefined()
    await waitFor(() => expect(result.current?.theme).toBe('light'))
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    act(() => api.setContext({ theme: 'dark' }))
    expect(result.current?.theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    act(() => api.setContext({ theme: 'black' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    unmount()
    act(() => api.setContext({ theme: 'light' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true) // no longer listening
  })

  it('falls back to a light context when getContext fails, instead of loading forever', async () => {
    const api = new MockGameApi()
    api.getContext = () => Promise.reject(new Error('no context'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wrapper = ({ children }: { children: ReactNode }) => <ApiProvider api={api}>{children}</ApiProvider>
    const { result } = renderHook(() => useAppContext(), { wrapper })
    await waitFor(() => expect(result.current).toEqual({ theme: 'light' }))
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('keeps a live change that arrives before the first getContext resolves', async () => {
    const api = new MockGameApi()
    let resolveFirst: (c: { theme: 'light' }) => void = () => {}
    api.getContext = () => new Promise((r) => { resolveFirst = r })
    const wrapper = ({ children }: { children: ReactNode }) => <ApiProvider api={api}>{children}</ApiProvider>
    const { result } = renderHook(() => useAppContext(), { wrapper })
    act(() => api.setContext({ theme: 'dark' }))
    await act(async () => resolveFirst({ theme: 'light' })) // older snapshot, arrives late
    expect(result.current?.theme).toBe('dark')
  })

  it('still returns the context when onContextChange is not implemented (throws)', async () => {
    const api = new MockGameApi({ context: { itemId: 'p1' } })
    api.onContextChange = () => { throw new Error('onContextChange: not implemented yet') }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wrapper = ({ children }: { children: ReactNode }) => <ApiProvider api={api}>{children}</ApiProvider>
    const { result } = renderHook(() => useAppContext(), { wrapper })
    await waitFor(() => expect(result.current?.itemId).toBe('p1'))
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
