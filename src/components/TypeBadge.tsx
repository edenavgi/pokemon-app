import type { PokeType } from '../api/GameApi'
import { Badge } from './ui/badge'

const COLORS: Record<PokeType, string> = {
  Normal: 'bg-stone-400 text-white', Fire: 'bg-orange-500 text-white', Water: 'bg-blue-500 text-white',
  Grass: 'bg-green-500 text-white', Electric: 'bg-yellow-400 text-black', Ice: 'bg-cyan-300 text-black',
  Fighting: 'bg-red-700 text-white', Poison: 'bg-purple-500 text-white', Ground: 'bg-amber-600 text-white',
  Flying: 'bg-sky-400 text-white', Psychic: 'bg-pink-500 text-white', Bug: 'bg-lime-500 text-black',
  Rock: 'bg-yellow-700 text-white', Ghost: 'bg-indigo-700 text-white', Dragon: 'bg-violet-600 text-white',
  Dark: 'bg-neutral-700 text-white', Steel: 'bg-slate-400 text-black', Fairy: 'bg-rose-300 text-black',
}

export function TypeBadge({ type }: { type: PokeType }) {
  return <Badge className={COLORS[type]}>{type}</Badge>
}
