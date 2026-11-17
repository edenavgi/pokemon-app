import type { Status } from '../api/GameApi'
import { Badge } from './ui/badge'

const COLORS: Record<Status, string> = {
  Recruited: 'bg-slate-500 text-white',
  Training: 'bg-blue-600 text-white',
  Ready: 'bg-green-600 text-white',
  Resting: 'bg-amber-500 text-black',
}

export function StatusBadge({ status }: { status: Status }) {
  return <Badge className={COLORS[status]}>{status}</Badge>
}
