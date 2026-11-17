import { useEffect, useState, type ComponentType } from 'react'

export const ROUTES = [
  'item-view',
  'board-view',
  'widget',
  'spar',
  'transfer',
  'column-view',
  'gym-hq',
  'setup',
] as const

export type RouteName = (typeof ROUTES)[number]

function NotFound() {
  return <p>Unknown screen</p>
}

// monday appends its own query after the hash route: "#/item-view?boardId=…&sessionToken=…"
function parseHash(hash: string): string {
  return hash.replace(/^#\/?/, '').split('?')[0]
}

function isRouteName(name: string): name is RouteName {
  return (ROUTES as readonly string[]).includes(name)
}

export function Router({ routes }: { routes: Record<RouteName, ComponentType> }) {
  const [hash, setHash] = useState(() => location.hash)

  useEffect(() => {
    const onHashChange = () => setHash(location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const name = parseHash(hash)
  const Screen = isRouteName(name) ? routes[name] : NotFound
  return <Screen />
}
