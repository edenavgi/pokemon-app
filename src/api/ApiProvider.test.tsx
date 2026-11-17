import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { GameApi } from './GameApi'
import { ApiProvider, useApi } from './ApiProvider'

describe('ApiProvider / useApi', () => {
  it('returns the same api object inside the provider', () => {
    const api = {} as GameApi
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ApiProvider api={api}>{children}</ApiProvider>
    )
    const { result } = renderHook(() => useApi(), { wrapper })
    expect(result.current).toBe(api)
  })

  it('throws outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => renderHook(() => useApi())).toThrow('useApi outside ApiProvider')
    } finally {
      spy.mockRestore()
    }
  })
})
