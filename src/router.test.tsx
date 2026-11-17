import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ComponentType } from 'react'
import { ROUTES, Router, type RouteName } from './router'

const stubRoutes = Object.fromEntries(
  ROUTES.map((name) => [name, () => <div data-testid={`route-${name}`}>{name}</div>]),
) as unknown as Record<RouteName, ComponentType>

describe('Router', () => {
  afterEach(() => {
    location.hash = ''
  })

  it.each(ROUTES)('renders the %s route from the hash', (name) => {
    location.hash = '#/' + name
    render(<Router routes={stubRoutes} />)
    expect(screen.getByTestId('route-' + name)).toBeInTheDocument()
  })

  it('ignores the query monday appends after the hash route', () => {
    location.hash = '#/item-view?boardId=1&itemId=2&sessionToken=abc&instanceId=3'
    render(<Router routes={stubRoutes} />)
    expect(screen.getByTestId('route-item-view')).toBeInTheDocument()
  })

  it('renders NotFound for an unknown hash', () => {
    location.hash = '#/nope'
    render(<Router routes={stubRoutes} />)
    expect(screen.getByText('Unknown screen')).toBeInTheDocument()
  })

  it('switches screens when the hash changes', () => {
    location.hash = '#/item-view'
    render(<Router routes={stubRoutes} />)
    expect(screen.getByTestId('route-item-view')).toBeInTheDocument()

    act(() => {
      location.hash = '#/spar'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })

    expect(screen.getByTestId('route-spar')).toBeInTheDocument()
    expect(screen.queryByTestId('route-item-view')).not.toBeInTheDocument()
  })
})
