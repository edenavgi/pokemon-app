import { useEffect, useState } from 'react'
import type { ArenaTurn, BattleView, Id } from '../../api/GameApi'
import { Button } from '../../components/ui/button'
import { replayText as t } from '../../lib/messages'

export const REPLAY_STEP_MS = 600

interface Hp { name: string; hp: number; max: number | null } // max is unknown until the fighter is hit

/**
 * Plays a finished battle turn by turn: one log line every `stepMs`, HP bars for the current matchup,
 * Skip → the end, then the result. The server already played it; this only shows the saved turns.
 */
export function BattleReplay({ battle, turns, stepMs = REPLAY_STEP_MS }: {
  battle: BattleView
  turns: ArenaTurn[]
  stepMs?: number
}) {
  const [shown, setShown] = useState(0)
  const done = shown >= turns.length

  useEffect(() => {
    if (done) return
    const timer = setTimeout(() => setShown((n) => n + 1), stepMs)
    return () => clearTimeout(timer)
  }, [shown, done, stepMs])

  const played = turns.slice(0, shown)
  const current = played.at(-1)

  return (
    <div className="flex flex-col gap-3">
      {current && <Matchup turns={played} current={current} />}
      <ol role="log" aria-label="Battle log" className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
        {played.map((turn) => (
          <li key={turn.n} className={turn.fainted ? 'font-medium' : undefined}>
            {t.turn(turn.n, turn.attackerName, turn.move)}
            {t.effectiveness(turn.effectiveness)}
            {turn.damage > 0 && t.damage(turn.defenderName, turn.damage)}
            {turn.fainted && t.fainted(turn.defenderName)}
          </li>
        ))}
      </ol>
      {done ? <Result battle={battle} /> : (
        <Button variant="outline" size="sm" className="self-start" onClick={() => setShown(turns.length)}>
          {t.skip}
        </Button>
      )}
    </div>
  )
}

/** The two fighters of the current matchup, side A on the left. */
function Matchup({ turns, current }: { turns: ArenaTurn[]; current: ArenaTurn }) {
  const hp = new Map<Id, Hp>()
  for (const turn of turns) {
    if (!hp.has(turn.attackerId)) hp.set(turn.attackerId, { name: turn.attackerName, hp: 0, max: null })
    hp.set(turn.defenderId, { name: turn.defenderName, hp: turn.defenderHpLeft, max: turn.defenderMaxHp })
  }
  const attacker = hp.get(current.attackerId)!
  const defender = hp.get(current.defenderId)!
  const [a, b] = current.side === 'A' ? [attacker, defender] : [defender, attacker]
  return (
    <div className="grid grid-cols-2 gap-4">
      <HpBar fighter={a} />
      <HpBar fighter={b} />
    </div>
  )
}

function HpBar({ fighter: { name, hp, max } }: { fighter: Hp }) {
  const pct = max === null ? 100 : Math.round((hp / max) * 100)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-sm">
        <span className="font-medium">{name}</span>
        {max !== null && <span className="text-muted-foreground">{t.hp(hp, max)}</span>}
      </div>
      <div
        role="progressbar"
        aria-label={name}
        aria-valuemin={0}
        aria-valuenow={max === null ? undefined : hp}
        aria-valuemax={max ?? undefined}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={`h-full transition-all ${pct > 50 ? 'bg-green-500' : pct > 20 ? 'bg-yellow-500' : 'bg-red-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function Result({ battle }: { battle: BattleView }) {
  const o = battle.outcome
  if (!o) return null
  const winner = o.winner === 'A' ? battle.gymA.name : o.winner === 'B' ? battle.gymB.name : null
  return <p role="status" className="font-medium">{t.headline(winner, o.mvp?.name ?? null)}</p>
}
