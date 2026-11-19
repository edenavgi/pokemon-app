import { useState } from 'react'
import { useApi } from '../../api/ApiProvider'
import type { Gym } from '../../api/GameApi'
import { Empty } from '../../components/States'
import { Button } from '../../components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { battle, battleSummary, type BattleResult } from '../../game/battle'
import { mulberry32, type Rng } from '../../game/rng'
import { battleErrorText, gymHqText as t } from '../../lib/messages'

type Played = { gymA: Gym; gymB: Gym; result: BattleResult & { ok: true } }

export function ArenaTab({ gyms, rng }: { gyms: Gym[]; rng?: Rng }) {
  const api = useApi()
  const [idA, setIdA] = useState<string>()
  const [idB, setIdB] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  const [played, setPlayed] = useState<Played>()

  if (gyms.length < 2) return <Empty title={t.needTwoGyms} />

  const gymA = gyms.find((g) => g.id === idA)
  const gymB = gyms.find((g) => g.id === idB)

  const fight = async () => {
    if (!gymA || !gymB || gymA.id === gymB.id || busy) return
    setBusy(true)
    setProblem(undefined)
    setPlayed(undefined)
    try {
      const chart = await api.getTypeChart()
      const result = battle(gymA, gymB, chart, rng ?? mulberry32(Date.now()))
      if (!result.ok) {
        setProblem(battleErrorText(result.error))
        return
      }
      setPlayed({ gymA, gymB, result })
      const summary = battleSummary(gymA, gymB, result)
      try {
        await Promise.all([api.postUpdate(gymA.id, summary), api.postUpdate(gymB.id, summary)])
      } catch {
        setProblem(t.postFailed)
      }
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
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
        <Button disabled={!gymA || !gymB || gymA.id === gymB.id || busy} onClick={fight}>
          {busy ? t.battling : t.battle}
        </Button>
      </div>
      {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
      {played && <Result played={played} />}
    </div>
  )
}

function Result({ played: { gymA, gymB, result } }: { played: Played }) {
  const winnerName = result.winner === 'A' ? gymA.name : result.winner === 'B' ? gymB.name : null
  return (
    <div className="flex flex-col gap-2">
      <p role="status" className="font-medium">{t.headline(winnerName, [result.winsA, result.winsB])}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.columns.round}</TableHead>
            <TableHead>{t.columns.a}</TableHead>
            <TableHead>{t.columns.scoreA}</TableHead>
            <TableHead>{t.columns.b}</TableHead>
            <TableHead>{t.columns.scoreB}</TableHead>
            <TableHead>{t.columns.winner}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rounds.map((r) => (
            <TableRow
              key={r.index}
              data-winner={r.winner === 'draw' ? undefined : r.winner}
              className={r.winner === 'draw' ? undefined : 'bg-primary/10 font-medium'}
            >
              <TableCell>{r.index}</TableCell>
              <TableCell>{r.a.name}</TableCell>
              <TableCell>{r.scoreA.toFixed(1)}</TableCell>
              <TableCell>{r.b.name}</TableCell>
              <TableCell>{r.scoreB.toFixed(1)}</TableCell>
              <TableCell>{r.winner === 'A' ? r.a.name : r.winner === 'B' ? r.b.name : t.draw}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
