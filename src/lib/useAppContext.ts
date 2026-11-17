import { useEffect, useState } from 'react'
import { useApi } from '../api/ApiProvider'
import type { AppContext } from '../api/GameApi'

export function useAppContext(): AppContext | undefined {
  const api = useApi()
  const [ctx, setCtx] = useState<AppContext>()

  useEffect(() => {
    let live = true
    const apply = (c: AppContext) => {
      if (!live) return
      setCtx(c)
      document.documentElement.classList.toggle('dark', c.theme !== 'light')
    }
    api.getContext().then(apply, (e: unknown) => console.warn('[useAppContext] getContext failed', e))

    // A missing/unimplemented listener must not take the whole screen down:
    // keep the initial context and carry on without live updates.
    let off: () => void = () => {}
    try {
      off = api.onContextChange(apply)
    } catch (e) {
      console.warn('[useAppContext] onContextChange failed; context will not live-update', e)
    }
    return () => { live = false; off() }
  }, [api])

  return ctx
}
