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

/**
 * What the tab can be waiting for: the OAuth callback, a NEW OAuth callback (reconnect: connectedAt
 * changes from the value it had when the button was pressed), or /start in Telegram.
 */
type Target = 'monday' | 'reconnect' | 'telegram'
function reached(s: ServerStatus, target: Target, connectedBefore: string | null): boolean {
  if (target === 'monday') return s.connected
  if (target === 'reconnect') return s.connected && s.connectedAt !== connectedBefore
  return s.telegramLinked
}

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
  const [starting, setStarting] = useState<Target>() // asking the server for the link
  const [waiting, setWaiting] = useState<Target>() // the link is open in another tab; polling
  const [timedOut, setTimedOut] = useState<Target>() // stopped polling; focus still checks
  const [problem, setProblem] = useState<{ target: Target; text: string }>()
  const [reconnected, setReconnected] = useState(false)
  const connectedBefore = useRef<string | null>(null) // connectedAt when Reconnect was pressed
  const current = status ?? loaded
  const arrived = (target: Target) => {
    if (target === 'reconnect') setReconnected(true)
  }

  // Poll while the user acts in the other tab; stop when it worked or after the max wait.
  useEffect(() => {
    if (!waiting) return
    let stopped = false
    const deadline = Date.now() + maxWaitMs
    const timer = setInterval(async () => {
      if (Date.now() >= deadline) {
        stopped = true
        clearInterval(timer)
        setWaiting(undefined)
        setTimedOut(waiting)
        return
      }
      try {
        const next = await api.getServerStatus()
        if (stopped) return
        setStatus(next)
        if (reached(next, waiting, connectedBefore.current)) {
          stopped = true
          clearInterval(timer)
          setWaiting(undefined)
          arrived(waiting)
        }
      } catch {
        // a missed poll is not an error worth showing; the next one tries again
      }
    }, pollMs)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [waiting, api, pollMs, maxWaitMs])

  // Coming back to this tab (after approving in monday or pressing Start in Telegram) → check at once.
  // Browsers also slow down timers in tabs and frames that are not in front, so polling alone can lag.
  const watching = waiting ?? timedOut
  useEffect(() => {
    if (!watching) return
    let active = true
    const checkNow = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const next = await api.getServerStatus()
        if (!active) return
        setStatus(next)
        if (reached(next, watching, connectedBefore.current)) {
          setWaiting(undefined)
          setTimedOut(undefined)
          arrived(watching)
        }
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
  }, [watching, api])

  // Connected but the server doesn't know the boards → send them, once.
  const synced = useRef(false)
  useEffect(() => {
    if (!current?.connected || current.boardsKnown || synced.current) return
    synced.current = true
    api
      .syncBoardConfig(cfg)
      .then(() => api.getServerStatus())
      .then(setStatus)
      .catch((e: unknown) => setProblem({ target: 'monday', text: e instanceof Error ? e.message : String(e) }))
  }, [current, api, cfg])

  if (error && !current) return <ErrorState error={error} onRetry={reload} />
  if (!current) return <Loading />

  /** Opens monday's consent screen or the bot's t.me link, then waits for the server to see the result. */
  const begin = async (target: Target) => {
    setProblem(undefined)
    setTimedOut(undefined)
    setStarting(target)
    if (target === 'reconnect') {
      connectedBefore.current = current.connectedAt
      setReconnected(false)
    }
    try {
      await (target === 'telegram' ? api.startTelegramLink() : api.startMondayOAuth())
      setWaiting(target)
    } catch (e) {
      setProblem({ target, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setStarting(undefined)
    }
  }

  const busy = (target: Target) => starting === target || waiting === target
  const note = (target: Target, waitingText: string, timedOutText: string) =>
    waiting === target ? waitingText : timedOut === target ? timedOutText : undefined
  const alert = (target: Target) =>
    problem?.target === target && <p role="alert" className="text-sm text-destructive">{problem.text}</p>

  return (
    <div className="flex max-w-xl flex-col gap-6 p-2">
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">{t.mondayTitle}</h2>
        <p className="text-sm text-muted-foreground">{t.mondayHint}</p>
        {current.connected ? (
          <>
            <p role="status" className="text-sm font-medium">{t.connected}</p>
            <p className="text-sm text-muted-foreground">{current.boardsKnown ? t.boardsSynced : t.syncingBoards}</p>
            <p className="text-sm text-muted-foreground">{t.reconnectHint}</p>
            {(note('reconnect', t.waiting, t.timedOut) ?? (reconnected ? t.reconnected : undefined)) && (
              <p role="status" className="text-sm">{note('reconnect', t.waiting, t.timedOut) ?? t.reconnected}</p>
            )}
            <div>
              <Button variant="outline" onClick={() => begin('reconnect')} disabled={busy('reconnect')}>{t.reconnectMonday}</Button>
            </div>
            {alert('reconnect')}
          </>
        ) : (
          <>
            <p className="text-sm">{note('monday', t.waiting, t.timedOut) ?? t.notConnected}</p>
            <div>
              <Button onClick={() => begin('monday')} disabled={busy('monday')}>{t.connectMonday}</Button>
            </div>
          </>
        )}
        {alert('monday')}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">{t.telegramTitle}</h2>
        <p className="text-sm text-muted-foreground">
          {current.telegramLinked ? t.telegramLinked : current.connected ? t.telegramHint : t.telegramNeedsMonday}
        </p>
        {note('telegram', t.telegramWaiting, t.telegramTimedOut) && (
          <p className="text-sm">{note('telegram', t.telegramWaiting, t.telegramTimedOut)}</p>
        )}
        <div>
          <Button variant="outline" disabled={!current.connected || busy('telegram')} onClick={() => begin('telegram')}>
            {current.telegramLinked ? t.relinkTelegram : t.connectTelegram}
          </Button>
        </div>
        {alert('telegram')}
      </section>
    </div>
  )
}
