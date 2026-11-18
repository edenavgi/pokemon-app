import { useApi } from '../../api/ApiProvider'
import { STATUSES, type BoardConfig } from '../../api/GameApi'
import { Empty, ErrorState, Loading } from '../../components/States'
import { StatusBadge } from '../../components/StatusBadge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { gymStats } from '../../game/stats'
import { widgetText as t } from '../../lib/messages'
import { useAppContext } from '../../lib/useAppContext'
import { useAsync } from '../../lib/useAsync'
import { RequireBoardConfig } from '../setup/RequireBoardConfig'

export function Widget() {
  const ctx = useAppContext()
  if (!ctx) return <Loading />
  return (
    <RequireBoardConfig>
      {(cfg) => <Stats cfg={cfg} boardIds={ctx.widgetBoardIds ?? []} />}
    </RequireBoardConfig>
  )
}

function Stats({ cfg, boardIds }: { cfg: BoardConfig; boardIds: string[] }) {
  const api = useApi()
  const hasGyms = boardIds.includes(cfg.gymsBoardId)
  const hasPokemon = boardIds.includes(cfg.pokemonBoardId)
  const { data: stats, error, reload } = useAsync(async () => {
    const [gyms, pokemon] = await Promise.all([
      hasGyms ? api.listGyms({ boardIds: [cfg.gymsBoardId] }) : undefined,
      hasPokemon ? api.listPokemon({ boardIds: [cfg.pokemonBoardId] }) : undefined,
    ])
    return gymStats({ gyms, pokemon })
  }, [api, hasGyms, hasPokemon, cfg.gymsBoardId, cfg.pokemonBoardId])

  if (!hasGyms && !hasPokemon) return <Empty title={t.noBoards} />
  if (error && !stats) return <ErrorState error={error} onRetry={reload} />
  if (!stats) return <Loading />

  return (
    <div className="flex flex-col gap-3 p-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.gym}</TableHead>
            <TableHead>{t.pokemon}</TableHead>
            <TableHead>{t.avgLevel}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats.perGym.map((r) => (
            <TableRow key={r.gymId}>
              <TableCell>{r.name}</TableCell>
              <TableCell>{r.count}</TableCell>
              <TableCell>{r.avgLevel === null ? t.noAvg : r.avgLevel.toFixed(1)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {stats.perStatus ? (
        <ul aria-label={t.byStatus} className="flex flex-wrap gap-3">
          {STATUSES.map((s) => (
            <li key={s} className="flex items-center gap-1">
              <StatusBadge status={s} />
              <span>{stats.perStatus![s]}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t.connectPokemon}</p>
      )}
    </div>
  )
}
