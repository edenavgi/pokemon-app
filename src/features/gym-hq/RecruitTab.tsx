import { useState } from 'react'
import { useApi } from '../../api/ApiProvider'
import { POKE_TYPES, type PokeType } from '../../api/GameApi'
import { ErrorState, Empty, Loading } from '../../components/States'
import { TypeBadge } from '../../components/TypeBadge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { canJoinGym } from '../../game/roster'
import { gymHqText as t, joinErrorText } from '../../lib/messages'
import { useAsync } from '../../lib/useAsync'
import type { TabProps } from './GymsTab'

type TypeFilter = PokeType | 'All'

export function RecruitTab({ gyms, reload }: TabProps) {
  const api = useApi()
  const species = useAsync(() => api.listGen1(), [api])
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('All')
  const [dex, setDex] = useState<number>()
  const [gymId, setGymId] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()

  if (species.error && !species.data) return <ErrorState error={species.error} onRetry={species.reload} />
  if (!species.data) return <Loading />

  const needle = query.trim().toLowerCase()
  const shown = species.data.filter(
    (s) => s.name.toLowerCase().includes(needle) && (typeFilter === 'All' || s.types.includes(typeFilter)),
  )
  const chosen = species.data.find((s) => s.dexNumber === dex)
  const gym = gyms.find((g) => g.id === gymId)

  const recruit = async () => {
    if (!chosen || !gym || busy) return
    setProblem(undefined)
    const v = canJoinGym(chosen, gym)
    if (!v.ok) {
      setProblem(joinErrorText(v.error, [chosen.name]))
      return
    }
    setBusy(true)
    try {
      const detail = await api.getSpecies(chosen.dexNumber)
      await api.recruit({ species: detail, gymId: gym.id })
      api.notify(t.recruitSuccess(chosen.name, gym.name), 'success')
      setDex(undefined)
      reload()
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      setProblem(err.message)
      api.notify(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t.search}
          placeholder={t.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-48"
        />
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
          <SelectTrigger aria-label={t.filterByType} className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">{t.allTypes}</SelectItem>
            {POKE_TYPES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={gymId ?? ''} onValueChange={setGymId}>
          <SelectTrigger aria-label={t.gym} className="w-48"><SelectValue placeholder={t.gym} /></SelectTrigger>
          <SelectContent>
            {gyms.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button disabled={!chosen || !gym || busy} onClick={recruit}>{busy ? t.recruiting : t.recruit}</Button>
      </div>
      {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
      {shown.length === 0 ? (
        <Empty title={t.noSpecies} />
      ) : (
        <ul aria-label="Pokémon" className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
          {shown.map((s) => (
            <li key={s.dexNumber}>
              <Button
                variant={s.dexNumber === dex ? 'default' : 'outline'}
                aria-pressed={s.dexNumber === dex}
                className="h-auto w-full flex-col gap-1 py-2"
                onClick={() => { setDex(s.dexNumber); setProblem(undefined) }}
              >
                <img src={s.spriteUrl} alt={s.name} className="size-14 [image-rendering:pixelated]" />
                <span>{s.name}</span>
                <span className="flex gap-1">{s.types.map((p) => <TypeBadge key={p} type={p} />)}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
