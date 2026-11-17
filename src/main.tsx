import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ApiProvider } from './api/ApiProvider.tsx'
import type { GameApi } from './api/GameApi.ts'
import { MockGameApi } from './api/mock/MockGameApi.ts'
import { createMondayGameApi } from './api/monday/index.ts'
import { RequireBoardConfig } from './features/setup/RequireBoardConfig.tsx'
import { ROUTES, Router, type RouteName } from './router.tsx'

// Placeholder screens; later tasks replace these with real ones.
function SetupScreen() {
  return (
    <RequireBoardConfig>
      {(cfg) => <p>Boards configured: {cfg.gymsBoardId} / {cfg.pokemonBoardId}</p>}
    </RequireBoardConfig>
  )
}

const routes = {
  ...(Object.fromEntries(ROUTES.map((name) => [name, () => <div>{name}</div>])) as unknown as Record<
    RouteName,
    ComponentType
  >),
  setup: SetupScreen,
}

// monday puts its query string after the hash, so check both places.
function wantsMock(): boolean {
  if (import.meta.env.VITE_USE_MOCK === '1') return true
  const hashQuery = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : ''
  return (
    new URLSearchParams(location.search).get('mock') === '1' ||
    new URLSearchParams(hashQuery).get('mock') === '1'
  )
}

const root = createRoot(document.getElementById('root')!)
try {
  const api: GameApi = wantsMock() ? new MockGameApi() : createMondayGameApi()
  root.render(
    <StrictMode>
      <ApiProvider api={api}>
        <Router routes={routes} />
      </ApiProvider>
    </StrictMode>,
  )
} catch (e) {
  root.render(<p role="alert">Could not start: {e instanceof Error ? e.message : String(e)}</p>)
}
