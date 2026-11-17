import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
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
})
