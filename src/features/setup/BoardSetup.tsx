import { useState } from 'react'
import { useApi } from '../../api/ApiProvider'
import type { BoardConfig } from '../../api/GameApi'
import { ErrorState, Loading } from '../../components/States'
import { Button } from '../../components/ui/button'
import { useAsync } from '../../lib/useAsync'

const SELECT_CLASS = 'h-8 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30'

export function BoardSetup({ onSaved }: { onSaved: (cfg: BoardConfig) => void }) {
  const api = useApi()
  const boards = useAsync(() => api.listBoards(), [api])
  const [gymsBoardId, setGyms] = useState('')
  const [pokemonBoardId, setPokemon] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<Error>()

  if (boards.loading && !boards.data) return <Loading />
  if (boards.error) return <ErrorState error={boards.error} onRetry={boards.reload} />

  const valid = gymsBoardId !== '' && pokemonBoardId !== '' && gymsBoardId !== pokemonBoardId

  async function save() {
    if (!valid || saving) return
    const cfg = { gymsBoardId, pokemonBoardId }
    setSaving(true)
    setSaveError(undefined)
    try {
      await api.setBoardConfig(cfg)
      onSaved(cfg)
    } catch (e) {
      setSaveError(e instanceof Error ? e : new Error(String(e)))
      setSaving(false)
    }
  }

  const options = (boards.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)
  return (
    <form className="flex max-w-sm flex-col gap-3 p-4" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <h1 className="text-lg font-medium">Choose your boards</h1>
      <label className="flex flex-col gap-1 text-sm">
        Gyms board
        <select className={SELECT_CLASS} value={gymsBoardId} onChange={(e) => setGyms(e.target.value)}>
          <option value="">Select a board…</option>
          {options}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Pokémon board
        <select className={SELECT_CLASS} value={pokemonBoardId} onChange={(e) => setPokemon(e.target.value)}>
          <option value="">Select a board…</option>
          {options}
        </select>
      </label>
      {gymsBoardId !== '' && gymsBoardId === pokemonBoardId && (
        <p role="alert" className="text-sm text-destructive">Pick two different boards.</p>
      )}
      {saveError && <p role="alert" className="text-sm text-destructive">{saveError.message}</p>}
      <Button type="submit" disabled={!valid || saving}>Save</Button>
    </form>
  )
}
