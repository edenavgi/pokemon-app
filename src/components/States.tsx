import { Button } from './ui/button'

export function Loading() {
  return <p role="status" className="p-4 text-sm text-muted-foreground">Loading…</p>
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 p-4 text-sm">
      <p className="text-destructive">{error.message}</p>
      <Button variant="outline" onClick={onRetry}>Retry</Button>
    </div>
  )
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="p-4 text-center text-sm">
      <p className="font-medium">{title}</p>
      {hint && <p className="text-muted-foreground">{hint}</p>}
    </div>
  )
}
