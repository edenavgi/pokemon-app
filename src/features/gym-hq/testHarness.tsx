import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ApiProvider } from '../../api/ApiProvider'
import { useApi } from '../../api/ApiProvider'
import type { Gym } from '../../api/GameApi'
import type { MockGameApi } from '../../api/mock/MockGameApi'
import { Loading } from '../../components/States'
import { useAsync } from '../../lib/useAsync'

// Test helper: owns the gyms list like GymHQ does, so tabs can be tested in isolation.
function Host({ children }: { children: (gyms: Gym[], reload: () => void) => ReactNode }) {
  const api = useApi()
  const { data, reload } = useAsync(() => api.listGyms(), [api])
  return data ? <>{children(data, reload)}</> : <Loading />
}

export function renderTab(api: MockGameApi, children: (gyms: Gym[], reload: () => void) => ReactNode) {
  return render(<ApiProvider api={api}><Host>{children}</Host></ApiProvider>)
}

// jsdom lacks these; Radix Select calls them when opening.
export function polyfillSelect() {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
}
