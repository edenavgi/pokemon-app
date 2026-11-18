import { useState } from 'react'
import { useApi } from '../../api/ApiProvider'
import type { BoardConfig, Pokemon, PokemonPatch } from '../../api/GameApi'
import { ErrorState, Loading } from '../../components/States'
import { StatusBadge } from '../../components/StatusBadge'
import { Button } from '../../components/ui/button'
import { applySpar, validateSpar } from '../../game/status'
import { selectionText, sparErrorText, sparText as t } from '../../lib/messages'
import { useAppContext } from '../../lib/useAppContext'
import { RequireBoardConfig } from '../setup/RequireBoardConfig'
import { selectionProblem, useNotifyError, useSelection } from './selection'

export function SparAction() {
  const ctx = useAppContext()
  if (!ctx) return <Loading />
  return (
    <RequireBoardConfig>
      {(cfg) => <Spar cfg={cfg} boardId={ctx.boardId} ids={ctx.selectedItemIds ?? []} />}
    </RequireBoardConfig>
  )
}

function Spar({ cfg, boardId, ids }: { cfg: BoardConfig; boardId?: string; ids: string[] }) {
  const api = useApi()
  const wrongBoard = boardId !== undefined && boardId !== cfg.pokemonBoardId
  const { data, error, reload } = useSelection(ids, wrongBoard)
  const selected = data?.selected
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<Error>()

  let invalidText: string | undefined
  if (wrongBoard) invalidText = selectionText.wrongBoard
  else if (data) {
    invalidText = selectionProblem(data, 'spar')
    if (!invalidText) {
      const v = validateSpar(data.selected)
      if (!v.ok) invalidText = sparErrorText(v.error, v.names)
    }
  }
  useNotifyError(invalidText)

  if (invalidText) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <h2 className="font-medium">{t.title}</h2>
        <p role="alert" className="text-sm text-destructive">{invalidText}</p>
      </div>
    )
  }

  if (error && !selected) return <ErrorState error={error} onRetry={reload} />
  if (!selected) return <Loading />

  const patches = selected.map((p) => ({ id: p.id, patch: applySpar(p) }))
  const confirm = async () => {
    setSaving(true)
    setSaveError(undefined)
    try {
      await api.updatePokemon(patches)
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      setSaveError(err)
      api.notify(err.message, 'error')
      setSaving(false)
      return
    }
    api.notify(t.success(selected[0].name, selected[1].name), 'success')
    api.closeFeature()
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="font-medium">{t.title}</h2>
      <ul className="flex flex-col gap-3">
        {selected.map((p, i) => (
          <Preview key={p.id} pokemon={p} patch={patches[i].patch} />
        ))}
      </ul>
      {saveError && <p role="alert" className="text-sm text-destructive">{saveError.message}</p>}
      <Button onClick={confirm} disabled={saving}>{saving ? t.saving : t.confirm}</Button>
    </div>
  )
}

function Preview({ pokemon: p, patch }: { pokemon: Pokemon; patch: PokemonPatch }) {
  return (
    <li aria-label={p.name} className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{p.name}</span>
      <span>{t.level}: {p.level} → {patch.level}</span>
      <span>{t.energy}: {p.energy} → {patch.energy}</span>
      <span className="flex items-center gap-1">
        {t.status}: <StatusBadge status={p.status} /> → <StatusBadge status={patch.status ?? p.status} />
      </span>
    </li>
  )
}
