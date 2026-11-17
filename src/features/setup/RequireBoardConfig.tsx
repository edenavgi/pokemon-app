import { useState, type ReactNode } from 'react'
import { useApi } from '../../api/ApiProvider'
import type { BoardConfig } from '../../api/GameApi'
import { ErrorState, Loading } from '../../components/States'
import { useAsync } from '../../lib/useAsync'
import { BoardSetup } from './BoardSetup'

export function RequireBoardConfig({ children }: { children: (cfg: BoardConfig) => ReactNode }) {
  const api = useApi()
  const cfg = useAsync(() => api.getBoardConfig(), [api])
  const [saved, setSaved] = useState<BoardConfig>()

  const config = saved ?? cfg.data
  if (config) return <>{children(config)}</>
  if (cfg.error) return <ErrorState error={cfg.error} onRetry={cfg.reload} />
  if (cfg.loading) return <Loading />
  return <BoardSetup onSaved={setSaved} />
}
