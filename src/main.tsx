import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { ROUTES, Router, type RouteName } from './router.tsx'

// Placeholder screens; later tasks replace these with real ones.
const routes = Object.fromEntries(
  ROUTES.map((name) => [name, () => <div>{name}</div>]),
) as unknown as Record<RouteName, ComponentType>

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router routes={routes} />
  </StrictMode>,
)
