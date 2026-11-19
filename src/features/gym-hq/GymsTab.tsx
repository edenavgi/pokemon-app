import { useState } from 'react'
import { useApi } from '../../api/ApiProvider'
import { POKE_TYPES, type Gym, type PokeType } from '../../api/GameApi'
import { PokemonCard } from '../../components/PokemonCard'
import { Empty } from '../../components/States'
import { TypeBadge } from '../../components/TypeBadge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { MAX_ROSTER } from '../../game/constants'
import { gymHqText as t } from '../../lib/messages'

export interface TabProps { gyms: Gym[]; reload: () => void }

export function GymsTab({ gyms, reload }: TabProps) {
  return (
    <div className="flex flex-col gap-4 p-2">
      <CreateGym reload={reload} />
      {gyms.length === 0 ? (
        <Empty title={t.noGyms} hint={t.noGymsHint} />
      ) : (
        <ul className="flex flex-col gap-2">
          {gyms.map((g) => <GymRow key={g.id} gym={g} />)}
        </ul>
      )}
    </div>
  )
}

function CreateGym({ reload }: { reload: () => void }) {
  const api = useApi()
  const [name, setName] = useState('')
  const [type, setType] = useState<PokeType>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error>()
  const trimmed = name.trim()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!trimmed || !type || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const gym = await api.createGym({ name: trimmed, type })
      api.notify(t.createSuccess(gym.name), 'success')
      setName('')
      setType(undefined)
      reload()
    } catch (err) {
      const e2 = err instanceof Error ? err : new Error(String(err))
      setError(e2)
      api.notify(e2.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <Input
        aria-label={t.gymName}
        placeholder={t.gymName}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-48"
      />
      <Select value={type ?? ''} onValueChange={(v) => setType(v as PokeType)}>
        <SelectTrigger aria-label={t.gymType} className="w-40">
          <SelectValue placeholder={t.pickType} />
        </SelectTrigger>
        <SelectContent>
          {POKE_TYPES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button type="submit" disabled={!trimmed || !type || busy}>{busy ? t.creating : t.create}</Button>
      {error && <p role="alert" className="w-full text-sm text-destructive">{error.message}</p>}
    </form>
  )
}

function GymRow({ gym }: { gym: Gym }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-2">
      <Button
        variant="ghost"
        className="justify-between"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2">
          <span className="font-medium">{gym.name}</span>
          {gym.type && <TypeBadge type={gym.type} />}
        </span>
        <span className="text-xs text-muted-foreground">{t.rosterCount(gym.roster.length, MAX_ROSTER)}</span>
      </Button>
      {open && (
        gym.roster.length === 0 ? (
          <Empty title={t.emptyRoster} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2">
            {gym.roster.map((p) => <PokemonCard key={p.id} pokemon={p} compact />)}
          </div>
        )
      )}
    </li>
  )
}
