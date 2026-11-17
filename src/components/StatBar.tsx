import { Progress } from './ui/progress'

export function StatBar({ label, value, max = 255 }: { label: string; value: number; max?: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <Progress
        className="h-2 flex-1"
        value={Math.min(100, (value / max) * 100)}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemax={max}
      />
      <span className="w-8 text-right tabular-nums">{value}</span>
    </div>
  )
}
