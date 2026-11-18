import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ApiProvider } from './api/ApiProvider.tsx'
import type { AppContext, GameApi } from './api/GameApi.ts'
import { MockGameApi } from './api/mock/MockGameApi.ts'
import { createMondayGameApi } from './api/monday/index.ts'
import { BoardView } from './features/board-view/BoardView.tsx'
import { ItemView } from './features/item-view/ItemView.tsx'
import { RequireBoardConfig } from './features/setup/RequireBoardConfig.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
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
  'board-view': BoardView,
  'item-view': ItemView,
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

// Dev convenience (mock mode only): ?itemId=p1&theme=dark&selectedItemIds=p1,p2 seeds the mock context.
function mockContext(): Partial<AppContext> {
  const hashQuery = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : ''
  const params = [new URLSearchParams(location.search), new URLSearchParams(hashQuery)]
  const get = (k: string) => params.map((p) => p.get(k)).find((v) => v)
  const list = (k: string) => get(k)?.split(',').filter(Boolean)
  const ctx: Partial<AppContext> = {}
  const theme = get('theme')
  if (theme === 'light' || theme === 'dark' || theme === 'black') ctx.theme = theme
  for (const k of ['itemId', 'boardId', 'columnId'] as const) {
    const v = get(k)
    if (v) ctx[k] = v
  }
  const sel = list('selectedItemIds')
  if (sel) ctx.selectedItemIds = sel
  const wb = list('widgetBoardIds')
  if (wb) ctx.widgetBoardIds = wb
  return ctx
}

const root = createRoot(document.getElementById('root')!)
try {
  const api: GameApi = wantsMock() ? new MockGameApi({ context: mockContext() }) : createMondayGameApi()
  root.render(
    <StrictMode>
      <ApiProvider api={api}>
        <ErrorBoundary>
          <Router routes={routes} />
        </ErrorBoundary>
      </ApiProvider>
    </StrictMode>,
  )
} catch (e) {
  root.render(<p role="alert">Could not start: {e instanceof Error ? e.message : String(e)}</p>)
}
