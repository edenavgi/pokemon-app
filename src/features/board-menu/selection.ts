import { useEffect } from 'react'
import { useApi } from '../../api/ApiProvider'
import type { Pokemon } from '../../api/GameApi'
import { joinErrorText, selectionText, sparErrorText } from '../../lib/messages'
import { useAsync } from '../../lib/useAsync'

export interface Selection { selected: Pokemon[]; duplicateNames: string[]; missing: boolean }

// Loads the unique selected ids. monday may drop unknown ids and dedupe repeats, so compare counts ourselves.
export function useSelection(ids: string[], skip: boolean) {
  const api = useApi()
  const key = ids.join(',')
  return useAsync(async (): Promise<Selection> => {
    if (skip) return { selected: [], duplicateNames: [], missing: false }
    const unique = [...new Set(ids)]
    const selected = await api.getPokemonMany(unique)
    const dupIds = new Set(ids.filter((id, i) => ids.indexOf(id) !== i))
    return {
      selected,
      duplicateNames: selected.filter((p) => dupIds.has(p.id)).map((p) => p.name),
      missing: selected.length < unique.length,
    }
  }, [api, key, skip])
}

// Rejection text for a selection that cannot be acted on, or undefined when it is fine.
export function selectionProblem(sel: Selection, kind: 'spar' | 'transfer'): string | undefined {
  if (sel.missing) return selectionText.notLoaded
  if (sel.duplicateNames.length === 0) return undefined
  return kind === 'spar' ? sparErrorText('DUPLICATE') : joinErrorText('DUPLICATE', sel.duplicateNames)
}

export function useNotifyError(text: string | undefined) {
  const api = useApi()
  useEffect(() => {
    if (text) api.notify(text, 'error')
  }, [api, text])
}
