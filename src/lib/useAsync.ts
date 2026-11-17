import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'

export interface AsyncState<T> { data?: T; error?: Error; loading: boolean; reload(): void }

// Runs fn on mount, on deps change and on reload(). Only the latest call may update state.
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true })
  const latest = useRef(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const run = useCallback(() => {
    const id = ++latest.current
    setState((s) => ({ ...s, loading: true, error: undefined }))
    // new Promise(...) also catches a synchronous throw from fn (e.g. a "not implemented yet" stub)
    new Promise<T>((resolve) => resolve(fnRef.current())).then(
      (data) => { if (id === latest.current) setState({ data, loading: false }) },
      (e: unknown) => {
        if (id === latest.current) setState({ error: e instanceof Error ? e : new Error(String(e)), loading: false })
      },
    )
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    run()
    return () => { latest.current++ } // invalidate on unmount / deps change
  }, [run, ...deps])

  return { ...state, reload: run }
}
