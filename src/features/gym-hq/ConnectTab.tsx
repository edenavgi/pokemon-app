import { useEffect, useRef, useState } from 'react'
import { useApi } from '../../api/ApiProvider'
import type { BoardConfig, ServerStatus } from '../../api/GameApi'
import { ErrorState, Loading } from '../../components/States'
import { Button } from '../../components/ui/button'
import { connectText as t } from '../../lib/messages'
import { useAsync } from '../../lib/useAsync'

/** After "Connect", ask the server every 2 s whether the OAuth callback has arrived… */
export const CONNECT_POLL_MS = 2000
/** …for at most 2 minutes. */
export const CONNECT_MAX_WAIT_MS = 120_000

type Phase = 'idle' | 'starting' | 'waiting' | 'timedOut'

export function ConnectTab({
  cfg,
  pollMs = CONNECT_POLL_MS,
  maxWaitMs = CONNECT_MAX_WAIT_MS,
}: {
  cfg: BoardConfig
  pollMs?: number
  maxWaitMs?: number
}) {
  const api = useApi()
  const { data: loaded, error, reload } = useAsync(() => api.getServerStatus(), [api])
  // The latest status: from the first load, then from polling and from the board sync
  const [status, setStatus] = useState<ServerStatus>()
  const [phase, setPhase] = useState<Phase>('idle')
  const [problem, setProblem] = useState<string>()
  const current = status ?? loaded

  // Poll while waiting for the user to approve in monday's tab; stop when connected or after the max wait.
  useEffect(() => {
    if (phase !== 'waiting') return
    let stopped = false
    const deadline = Date.now() + maxWaitMs
    const timer = setInterval(async () => {
      if (Date.now() >= deadline) {
        stopped = true
        clearInterval(timer)
        setPhase('timedOut')
        return
      }
      try {
        const next = await api.getServerStatus()
        if (stopped) return
        setStatus(next)
        if (next.connected) {
          stopped = true
          clearInterval(timer)
          setPhase('idle')
        }
      } catch {
        // a missed poll is not an error worth showing; the next one tries again
      }
    }, pollMs)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [phase, api, pollMs, maxWaitMs])

  // Coming back to this tab (after approving in monday's tab) → check at once. Browsers also slow
  // down timers in tabs and frames that are not in front, so polling alone can lag.
  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'timedOut') return
    let active = true
    const checkNow = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const next = await api.getServerStatus()
        if (!active) return
        setStatus(next)
        if (next.connected) setPhase('idle')
      } catch {
        // the next poll or focus tries again
      }
    }
    window.addEventListener('focus', checkNow)
    document.addEventListener('visibilitychange', checkNow)
    return () => {
      active = false
      window.removeEventListener('focus', checkNow)
      document.removeEventListener('visibilitychange', checkNow)
    }
  }, [phase, api])

  // Connected but the server doesn't know the boards → send them, once.
  const synced = useRef(false)
  useEffect(() => {
    if (!current?.connected || current.boardsKnown || synced.current) return
    synced.current = true
    api
      .syncBoardConfig(cfg)
      .then(() => api.getServerStatus())
      .then(setStatus)
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)))
  }, [current, api, cfg])

  if (error && !current) return <ErrorState error={error} onRetry={reload} />
  if (!current) return <Loading />

  const connect = async () => {
    setProblem(undefined)
    setPhase('starting')
    try {
      await api.startMondayOAuth()
      setPhase('waiting')
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
      setPhase('idle')
    }
  }

  const busy = phase === 'starting' || phase === 'waiting'

  return (
    <div className="flex max-w-xl flex-col gap-6 p-2">
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">{t.mondayTitle}</h2>
        <p className="text-sm text-muted-foreground">{t.mondayHint}</p>
        {current.connected ? (
          <>
            <p role="status" className="text-sm font-medium">{t.connected}</p>
            <p className="text-sm text-muted-foreground">{current.boardsKnown ? t.boardsSynced : t.syncingBoards}</p>
          </>
        ) : (
          <>
            <p className="text-sm">{phase === 'waiting' ? t.waiting : phase === 'timedOut' ? t.timedOut : t.notConnected}</p>
            <div>
              <Button onClick={connect} disabled={busy}>{t.connectMonday}</Button>
            </div>
          </>
        )}
        {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">{t.telegramTitle}</h2>
        <p className="text-sm text-muted-foreground">
          {current.telegramLinked ? t.telegramLinked : current.connected ? t.telegramHint : t.telegramNeedsMonday}
        </p>
        <TelegramButton enabled={current.connected} />
      </section>
    </div>
  )
}

// Linking Telegram arrives in Task 9; until then the button only says so.
function TelegramButton({ enabled }: { enabled: boolean }) {
  const [clicked, setClicked] = useState(false)
  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="outline" disabled={!enabled} onClick={() => setClicked(true)}>{t.connectTelegram}</Button>
      {clicked && <p className="text-xs text-muted-foreground">{t.telegramSoon}</p>}
    </div>
  )
}
