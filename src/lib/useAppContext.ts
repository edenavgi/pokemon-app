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
    api.getContext().then(apply, () => {})
    const off = api.onContextChange(apply)
    return () => { live = false; off() }
  }, [api])

  return ctx
}
