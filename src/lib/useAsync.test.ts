import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAsync } from './useAsync'

describe('useAsync', () => {
  it('turns a synchronous throw into an error state (e.g. a "not implemented yet" stub)', async () => {
    const fn = (): Promise<number> => { throw new Error('getPokemon: not implemented yet') }
    const { result } = renderHook(() => useAsync(fn, []))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error?.message).toBe('getPokemon: not implemented yet')
  })

  it('goes loading -> data', async () => {
    const { result } = renderHook(() => useAsync(() => Promise.resolve(5), []))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBe(5)
    expect(result.current.error).toBeUndefined()
  })

  it('exposes a rejection as error', async () => {
    const { result } = renderHook(() => useAsync(() => Promise.reject(new Error('boom')), []))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error?.message).toBe('boom')
    expect(result.current.data).toBeUndefined()
  })

  it('reload calls fn again', async () => {
    const fn = vi.fn(() => Promise.resolve(1))
    const { result } = renderHook(() => useAsync(fn, []))
    await waitFor(() => expect(result.current.loading).toBe(false))
    act(() => result.current.reload())
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  it('ignores a stale result when a later call wins', async () => {
    const resolvers: ((v: string) => void)[] = []
    const fn = () => new Promise<string>((r) => resolvers.push(r))
    const { result } = renderHook(() => useAsync(fn, []))
    act(() => result.current.reload())
    expect(resolvers).toHaveLength(2)
    await act(async () => { resolvers[1]('new') })
    await act(async () => { resolvers[0]('old') })
    expect(result.current.data).toBe('new')
    expect(result.current.loading).toBe(false)
  })

  it('does not set state after unmount', async () => {
    let resolve!: (v: number) => void
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = renderHook(() => useAsync(() => new Promise<number>((r) => { resolve = r }), []))
    unmount()
    await act(async () => { resolve(1) })
    expect(err).not.toHaveBeenCalled()
    err.mockRestore()
  })
})
