import { useState } from 'react'
import { useApi } from '../../api/ApiProvider'
import type { Pokemon, PokemonPatch } from '../../api/GameApi'
import { PokemonCard } from '../../components/PokemonCard'
import { Empty, ErrorState, Loading } from '../../components/States'
import { Button } from '../../components/ui/button'
import { applyEvolution, evolutionCheck, evolutionMessage } from '../../game/evolution'
import { allowedTransitions, applyRest } from '../../game/status'
import { evoBlockText, statusDialogText as t } from '../../lib/messages'
import { useAppContext } from '../../lib/useAppContext'
import { useAsync } from '../../lib/useAsync'

export function StatusDialog() {
  const ctx = useAppContext()
  if (!ctx) return <Loading />
  if (!ctx.itemId) return <Empty title={t.notInItem} />
  return <Dialog key={ctx.itemId} itemId={ctx.itemId} />
}

const toError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)))

function Dialog({ itemId }: { itemId: string }) {
  const api = useApi()
  const { data: pokemon, error, reload } = useAsync(() => api.getPokemon(itemId), [itemId])
  const [busy, setBusy] = useState(false)
  // Dex of the form we just evolved away from: stays disabled until the reload shows a different form.
  const [staleDex, setStaleDex] = useState<number>()
  const [writeError, setWriteError] = useState<Error>()
  const [done, setDone] = useState<string>()

  // Written and asked monday to close; if the window stays open, say what happened instead of "Saving…"
  if (done) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <h2 className="font-medium">{t.title}</h2>
        <p role="status" className="text-sm">{done}</p>
      </div>
    )
  }
  if (error && !pokemon) return <ErrorState error={error} onRetry={reload} />
  if (!pokemon) return <Loading />
  if (error && staleDex === pokemon.dexNumber) return <ErrorState error={error} onRetry={reload} />
  const locked = busy || staleDex === pokemon.dexNumber

  const fail = (e: unknown) => {
    const err = toError(e)
    setWriteError(err)
    api.notify(err.message, 'error')
    setBusy(false)
  }

  // Status and Rest: one write, a notice, then close.
  const write = async (patch: PokemonPatch, success: string) => {
    setBusy(true)
    setWriteError(undefined)
    try {
      await api.updatePokemon([{ id: itemId, patch }])
    } catch (e) {
      fail(e)
      return
    }
    api.notify(success, 'success')
    setDone(success)
    api.closeFeature()
  }

  const evolve = async (targetDex: number) => {
    setBusy(true)
    setWriteError(undefined)
    try {
      const species = await api.getSpecies(targetDex)
      await api.updatePokemon([{ id: itemId, patch: applyEvolution(species) }])
      setStaleDex(pokemon.dexNumber)
      reload()
      try {
        await api.postUpdate(itemId, evolutionMessage(pokemon.name, species.name))
      } catch {
        // The item has already evolved: show the new form, and report the missing update.
        fail(new Error(t.updateFailed))
        return
      }
      api.notify(t.evolveSuccess(pokemon.name, species.name), 'success')
      setBusy(false)
    } catch (e) {
      fail(e)
    }
  }

  const { to, canRest } = allowedTransitions(pokemon)

  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="font-medium">{t.title}</h2>
      <PokemonCard pokemon={pokemon} compact />
      <div className="flex flex-wrap gap-2">
        {to.map((status) => (
          <Button
            key={status}
            variant="outline"
            disabled={locked}
            onClick={() => write({ status }, t.statusSuccess(pokemon.name, status))}
          >
            {t.moveTo(status)}
          </Button>
        ))}
        {canRest && (
          <Button disabled={locked} onClick={() => write(applyRest(pokemon), t.restSuccess(pokemon.name))}>
            {t.rest}
          </Button>
        )}
      </div>
      {writeError && <p role="alert" className="text-sm text-destructive">{writeError.message}</p>}
      <EvolutionSection key={pokemon.dexNumber} pokemon={pokemon} busy={busy} locked={locked} onEvolve={evolve} />
    </div>
  )
}

function EvolutionSection({ pokemon, busy, locked, onEvolve }: { pokemon: Pokemon; busy: boolean; locked: boolean; onEvolve: (dex: number) => void }) {
  const api = useApi()
  const { data, error } = useAsync(async () => {
    const check = evolutionCheck(pokemon, await api.getEvolution(pokemon.dexNumber))
    if (!check.eligible) return { check, species: undefined }
    return { check, species: await api.getSpecies(check.target.dexNumber) }
  }, [pokemon.dexNumber, pokemon.level])

  if (error) return <p className="text-xs text-muted-foreground">{t.evoLoadFailed}</p>
  if (!data) return null
  const { check, species } = data
  if (!check.eligible) {
    return <p className="text-xs text-muted-foreground">{evoBlockText(check.reason, check.atLevel)}</p>
  }
  if (!species) return null
  return (
    <div className="flex items-center gap-3">
      <img src={species.spriteUrl} alt={species.name} className="size-14 shrink-0 [image-rendering:pixelated]" />
      <span className="text-sm">{t.evolveTo(species.name)}</span>
      <Button disabled={locked} onClick={() => onEvolve(check.target.dexNumber)}>
        {busy ? t.evolving : t.evolve}
      </Button>
    </div>
  )
}
