import { useState } from 'react'
import { useApi } from '../../api/ApiProvider'
import { STATUSES, type Status } from '../../api/GameApi'
import { PokemonCard } from '../../components/PokemonCard'
import { Empty, ErrorState, Loading } from '../../components/States'
import { Button } from '../../components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { boardViewText as t } from '../../lib/messages'
import { useAppContext } from '../../lib/useAppContext'
import { useAsync } from '../../lib/useAsync'

type Filter = Status | 'All'

export function BoardView() {
  const ctx = useAppContext()
  if (!ctx) return <Loading />
  return <Roster boardId={ctx.boardId} />
}

function Roster({ boardId }: { boardId?: string }) {
  const api = useApi()
  const { data: gyms, error, reload } = useAsync(
    () => (boardId ? api.listGyms({ boardIds: [boardId] }) : api.listGyms()),
    [api, boardId],
  )
  const [gymId, setGymId] = useState<string>()
  const [filter, setFilter] = useState<Filter>('All')

  if (error && !gyms) return <ErrorState error={error} onRetry={reload} />
  if (!gyms) return <Loading />
  if (gyms.length === 0) return <Empty title={t.noGyms} />

  const gym = gyms.find((g) => g.id === gymId) ?? gyms[0]
  const shown = filter === 'All' ? gym.roster : gym.roster.filter((p) => p.status === filter)

  return (
    <div className="flex flex-col gap-3 p-2">
      <Select value={gym.id} onValueChange={setGymId}>
        <SelectTrigger aria-label={t.gym}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {gyms.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <div role="group" aria-label={t.filterByStatus} className="flex flex-wrap gap-1">
        {(['All', ...STATUSES] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'default' : 'outline'}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {f === 'All' ? t.all : f}
          </Button>
        ))}
      </div>
      {gym.roster.length === 0 ? (
        <Empty title={t.emptyGym} />
      ) : shown.length === 0 ? (
        <Empty title={t.emptyFilter} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2">
          {shown.map((p) => <PokemonCard key={p.id} pokemon={p} compact />)}
        </div>
      )}
    </div>
  )
}
