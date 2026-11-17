import { createContext, useContext, type ReactNode } from 'react'
import type { GameApi } from './GameApi'

const ApiContext = createContext<GameApi | null>(null)

export function ApiProvider({ api, children }: { api: GameApi; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
}

export function useApi(): GameApi {
  const api = useContext(ApiContext)
  if (!api) throw new Error('useApi outside ApiProvider')
  return api
}
