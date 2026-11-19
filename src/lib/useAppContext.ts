import { useEffect, useState } from 'react'
import { useApi } from '../api/ApiProvider'
import type { AppContext } from '../api/GameApi'

export function useAppContext(): AppContext | undefined {
  const api = useApi()
  const [ctx, setCtx] = useState<AppContext>()

  useEffect(() => {
    let live = true
    let changed = false // a live change already arrived: the first snapshot is older, ignore it
    const apply = (c: AppContext) => {
      if (!live) return
      setCtx(c)
      document.documentElement.classList.toggle('dark', c.theme !== 'light')
    }
    api.getContext().then(
      (c) => { if (!changed) apply(c) },
      (e: unknown) => {
        // Without a context the screen would stay on Loading forever: carry on with the defaults
        console.warn('[useAppContext] getContext failed; using a light theme', e)
        if (!changed) apply({ theme: 'light' })
      },
    )

    // A missing/unimplemented listener must not take the whole screen down:
    // keep the initial context and carry on without live updates.
    let off: () => void = () => {}
    try {
      off = api.onContextChange((c) => { changed = true; apply(c) })
    } catch (e) {
      console.warn('[useAppContext] onContextChange failed; context will not live-update', e)
    }
    return () => { live = false; off() }
  }, [api])

  return ctx
}
