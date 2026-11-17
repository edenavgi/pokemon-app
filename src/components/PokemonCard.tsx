import type { Pokemon } from '../api/GameApi'
import { StatBar } from './StatBar'
import { StatusBadge } from './StatusBadge'
import { TypeBadge } from './TypeBadge'
import { Card, CardContent } from './ui/card'

export function PokemonCard({ pokemon, compact = false }: { pokemon: Pokemon; compact?: boolean }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <img src={pokemon.spriteUrl} alt={pokemon.name} className="size-14 shrink-0 [image-rendering:pixelated]" />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate font-medium">{pokemon.name}</span>
            <span className="text-xs text-muted-foreground">Lv. {pokemon.level}</span>
            <div className="flex flex-wrap gap-1">
              <StatusBadge status={pokemon.status} />
              {!compact && pokemon.types.map((t) => <TypeBadge key={t} type={t} />)}
            </div>
          </div>
        </div>
        {!compact && (
          <div className="flex flex-col gap-1">
            <StatBar label="HP" value={pokemon.hp} />
            <StatBar label="Attack" value={pokemon.attack} />
            <StatBar label="Defense" value={pokemon.defense} />
            <StatBar label="Speed" value={pokemon.speed} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
