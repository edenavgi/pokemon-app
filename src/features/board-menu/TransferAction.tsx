import { useState } from 'react'
import { useApi } from '../../api/ApiProvider'
import type { BoardConfig, Gym, Pokemon } from '../../api/GameApi'
import { Empty, ErrorState, Loading } from '../../components/States'
import { Button } from '../../components/ui/button'
import { validateTransfer } from '../../game/roster'
import { joinErrorText, selectionText, transferText as t } from '../../lib/messages'
import { useAppContext } from '../../lib/useAppContext'
import { useAsync } from '../../lib/useAsync'
import { RequireBoardConfig } from '../setup/RequireBoardConfig'
import { selectionProblem, useNotifyError, useSelection } from './selection'

export function TransferAction() {
  const ctx = useAppContext()
  if (!ctx) return <Loading />
  const ids = ctx.selectedItemIds ?? []
  if (ids.length === 0) return <Empty title={t.noSelection} />
  return <RequireBoardConfig>{(cfg) => <Transfer cfg={cfg} boardId={ctx.boardId} ids={ids} />}</RequireBoardConfig>
}

function Transfer({ cfg, boardId, ids }: { cfg: BoardConfig; boardId?: string; ids: string[] }) {
  const api = useApi()
  const wrongBoard = boardId !== undefined && boardId !== cfg.pokemonBoardId
  const sel = useSelection(ids, wrongBoard)
  const gymsState = useAsync(
    async () => (wrongBoard ? [] : api.listGyms({ boardIds: [cfg.gymsBoardId] })),
    [api, wrongBoard, cfg.gymsBoardId],
  )
  const problem = wrongBoard ? selectionText.wrongBoard : sel.data ? selectionProblem(sel.data, 'transfer') : undefined
  useNotifyError(problem)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<Error>()

  if (problem) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <h2 className="font-medium">{t.title}</h2>
        <p role="alert" className="text-sm text-destructive">{problem}</p>
      </div>
    )
  }
  const error = sel.error ?? gymsState.error
  if (error && !(sel.data && gymsState.data)) {
    return <ErrorState error={error} onRetry={() => { sel.reload(); gymsState.reload() }} />
  }
  if (!sel.data || !gymsState.data) return <Loading />
  const selected = sel.data.selected
  const gyms = gymsState.data

  const sharedGymId = sharedGym(selected)
  const candidates = gyms.filter((g) => g.id !== sharedGymId)
  if (candidates.length === 0) return <Empty title={t.noGyms} />

  const choose = async (gym: Gym, moving: Pokemon[]) => {
    if (moving.length === 0) {
      api.notify(t.nothingToMove, 'info')
      return
    }
    setBusy(true)
    setSaveError(undefined)
    try {
      await api.setGym(moving.map((p) => p.id), gym.id)
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      setSaveError(err)
      api.notify(err.message, 'error')
      setBusy(false)
      return
    }
    api.notify(t.success(moving.map((p) => p.name), gym.name), 'success')
    api.closeFeature()
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="font-medium">{t.title}</h2>
      {saveError && <p role="alert" className="text-sm text-destructive">{saveError.message}</p>}
      <ul className="flex flex-col gap-2">
        {candidates.map((gym) => {
          const v = validateTransfer(selected, gym)
          return (
            <li key={gym.id} className="flex flex-col gap-1">
              <Button
                variant="outline"
                className="justify-between"
                disabled={!v.ok || busy}
                onClick={() => v.ok && choose(gym, v.moving)}
              >
                <span>{gym.name}</span>
                <span className="text-xs text-muted-foreground">{t.gymMeta(gym.type, gym.roster.length)}</span>
              </Button>
              {!v.ok && <p className="text-xs text-muted-foreground">{joinErrorText(v.error, v.names)}</p>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function sharedGym(ps: Pokemon[]): string | null {
  const first = ps[0]?.gym?.id
  return first && ps.every((p) => p.gym?.id === first) ? first : null
}
