import { useEffect } from 'react'
import { useApi } from '../../api/ApiProvider'
import { Empty, ErrorState, Loading } from '../../components/States'
import { StatBar } from '../../components/StatBar'
import { StatusBadge } from '../../components/StatusBadge'
import { TypeBadge } from '../../components/TypeBadge'
import { Card, CardContent } from '../../components/ui/card'
import { MAX_ENERGY } from '../../game/constants'
import { itemViewText as t } from '../../lib/messages'
import { useAppContext } from '../../lib/useAppContext'
import { useAsync } from '../../lib/useAsync'
import { TalkPanel } from './TalkPanel'

export function ItemView() {
  const ctx = useAppContext()
  if (!ctx) return <Loading />
  if (!ctx.itemId) return <Empty title={t.notInItem} />
  return <Profile key={ctx.itemId} itemId={ctx.itemId} />
}

function Profile({ itemId }: { itemId: string }) {
  const api = useApi()
  const { data: pokemon, error, reload } = useAsync(() => api.getPokemon(itemId), [itemId])

  useEffect(() => api.onItemChanged(itemId, reload), [api, itemId, reload])

  if (error && !pokemon) return <ErrorState error={error} onRetry={reload} />
  if (!pokemon) return <Loading />

  return (
    <Card className="m-2">
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <img
            src={pokemon.spriteUrl}
            alt={pokemon.name}
            className="size-24 shrink-0 [image-rendering:pixelated]"
          />
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <h1 className="text-xl font-semibold">{pokemon.name}</h1>
              <span className="text-sm text-muted-foreground">#{pokemon.dexNumber}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {pokemon.types.map((t) => <TypeBadge key={t} type={t} />)}
              <StatusBadge status={pokemon.status} />
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div><dt className="text-muted-foreground">{t.level}</dt><dd>{pokemon.level}</dd></div>
          <div><dt className="text-muted-foreground">{t.energy}</dt><dd>{pokemon.energy} / {MAX_ENERGY}</dd></div>
          <div><dt className="text-muted-foreground">{t.gym}</dt><dd>{pokemon.gym?.name ?? t.noGym}</dd></div>
        </dl>
        <div className="flex flex-col gap-1">
          <StatBar label={t.hp} value={pokemon.hp} />
          <StatBar label={t.attack} value={pokemon.attack} />
          <StatBar label={t.defense} value={pokemon.defense} />
          <StatBar label={t.speed} value={pokemon.speed} />
        </div>
        <TalkPanel pokemon={pokemon} />
      </CardContent>
    </Card>
  )
}
