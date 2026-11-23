import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../../api/ApiProvider'
import type { ArenaTurn, BattleView, Gym, Id } from '../../api/GameApi'
import { ServerError } from '../../api/server/serverClient'
import { Empty } from '../../components/States'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { battleErrorText, gymHqText as t } from '../../lib/messages'
import { BattleReplay, REPLAY_STEP_MS } from './BattleReplay'

export const ARENA_POLL_MS = 1500
export const ARENA_MAX_WAIT_MS = 120_000

type Replay = { battle: BattleView; turns: ArenaTurn[] }

/** Error text for a failed POST /api/battles. */
function startErrorText(e: unknown): string {
  if (e instanceof ServerError) {
    if (e.code === 'SAME_GYM' || e.code === 'A_NOT_ELIGIBLE' || e.code === 'B_NOT_ELIGIBLE') return battleErrorText(e.code)
    if (e.code === 'NOT_CONNECTED' || e.code === 'NO_BOARDS') return t.connectFirst
  }
  return e instanceof Error ? e.message : String(e)
}

/**
 * The Arena. The battle runs on the server (queue → engine → board): this tab only starts it,
 * waits for it to finish, and replays the saved turns. It never writes to the board itself.
 */
export function ArenaTab({ gyms, reload, pollMs = ARENA_POLL_MS, maxWaitMs = ARENA_MAX_WAIT_MS, stepMs = REPLAY_STEP_MS }: {
  gyms: Gym[]
  reload: () => void
  pollMs?: number
  maxWaitMs?: number
  stepMs?: number
}) {
  const api = useApi()
  const [idA, setIdA] = useState<string>()
  const [idB, setIdB] = useState<string>()
  const [waitingFor, setWaitingFor] = useState<Id>() // a battle we started that is not done yet
  const [problem, setProblem] = useState<string>()
  const [replay, setReplay] = useState<Replay>()
  const [recent, setRecent] = useState<BattleView[]>([])

  const loadRecent = useCallback(() => {
    api.listBattles(10).then(setRecent, (e: unknown) => console.warn('[ArenaTab] could not list battles', e))
  }, [api])
  useEffect(loadRecent, [loadRecent])

  const show = useCallback(async (battleId: Id) => {
    const { battle, turns } = await api.getBattle(battleId, { turns: true })
    setReplay({ battle, turns: turns ?? [] })
  }, [api])

  // Wait for the battle we started: ask without the turns until it is done, then load them once.
  useEffect(() => {
    if (!waitingFor) return
    let stopped = false
    const deadline = Date.now() + maxWaitMs
    const finish = (text?: string) => {
      stopped = true
      clearInterval(timer)
      setWaitingFor(undefined)
      if (text) setProblem(text)
    }
    const timer = setInterval(async () => {
      if (stopped) return
      if (Date.now() > deadline) return finish(t.timedOut)
      try {
        const { battle } = await api.getBattle(waitingFor, { turns: false })
        if (stopped) return
        if (battle.status === 'failed') return finish(t.failed(battle.error ?? 'UNKNOWN'))
        if (battle.status !== 'done') return
        finish()
        await show(waitingFor)
        reload() // the server changed Energy/Status on the board
        loadRecent()
      } catch (e) {
        if (!stopped) finish(e instanceof Error ? e.message : String(e))
      }
    }, pollMs)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [waitingFor, api, pollMs, maxWaitMs, show, reload, loadRecent])

  if (gyms.length < 2) return <Empty title={t.needTwoGyms} />

  const gymA = gyms.find((g) => g.id === idA)
  const gymB = gyms.find((g) => g.id === idB)
  const busy = waitingFor !== undefined

  const fight = async () => {
    if (!gymA || !gymB || gymA.id === gymB.id || busy) return
    setProblem(undefined)
    setReplay(undefined)
    try {
      const { battleId } = await api.startBattle(gymA.id, gymB.id)
      setWaitingFor(battleId)
    } catch (e) {
      setProblem(startErrorText(e))
    }
  }

  const replayOne = async (battleId: Id) => {
    setProblem(undefined)
    setReplay(undefined)
    try {
      await show(battleId)
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    }
  }

  const picker = (label: string, value: string | undefined, other: string | undefined, set: (v: string) => void) => (
    <Select value={value ?? ''} onValueChange={set}>
      <SelectTrigger aria-label={label} className="w-48"><SelectValue placeholder={label} /></SelectTrigger>
      <SelectContent>
        {gyms.map((g) => <SelectItem key={g.id} value={g.id} disabled={g.id === other}>{g.name}</SelectItem>)}
      </SelectContent>
    </Select>
  )

  return (
    <div className="flex flex-col gap-3 p-2">
      <div className="flex flex-wrap items-center gap-2">
        {picker(t.gymA, idA, idB, setIdA)}
        {picker(t.gymB, idB, idA, setIdB)}
        <Button disabled={!gymA || !gymB || gymA.id === gymB.id || busy} onClick={fight}>{t.battle}</Button>
      </div>
      {busy && <p className="text-sm text-muted-foreground">{t.queued}</p>}
      {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
      {replay && <BattleReplay key={replay.battle.id} battle={replay.battle} turns={replay.turns} stepMs={stepMs} />}
      {recent.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 id="recent-battles" className="text-sm font-medium">{t.recent}</h3>
          <ul aria-labelledby="recent-battles" className="flex flex-col gap-1">
            {recent.map((b) => (
              <li key={b.id} className="flex items-center gap-2 text-sm">
                <span>{t.versus(b.gymA.name, b.gymB.name)}</span>
                {b.source === 'telegram' && <Badge variant="secondary">{t.fromTelegram}</Badge>}
                {b.status === 'done' && (
                  <Button variant="ghost" size="sm" onClick={() => replayOne(b.id)}>{t.replay}</Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
