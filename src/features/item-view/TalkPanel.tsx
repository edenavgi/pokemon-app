import { useEffect, useRef, useState } from 'react'
import { useApi } from '../../api/ApiProvider'
import type { Pokemon } from '../../api/GameApi'
import { Button } from '../../components/ui/button'
import { buildTalkPrompt } from '../../game/talk'
import { itemViewText as t, talkFallbackText } from '../../lib/messages'

export function TalkPanel({ pokemon }: { pokemon: Pokemon }) {
  const api = useApi()
  const [reply, setReply] = useState<string>()
  const [busy, setBusy] = useState(false)
  const token = useRef(0)

  // A different Pokémon or species invalidates the reply and any in-flight request.
  useEffect(() => {
    token.current++
    setReply(undefined)
    setBusy(false)
  }, [pokemon.id, pokemon.dexNumber])

  async function talk() {
    const mine = ++token.current
    const name = pokemon.name
    setBusy(true)
    let text: string
    try {
      const species = await api.getSpecies(pokemon.dexNumber)
      text = await api.talk(buildTalkPrompt(species))
    } catch (e) {
      console.warn('Talk failed', e)
      text = talkFallbackText(name)
    }
    if (mine !== token.current) return
    setReply(text)
    setBusy(false)
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={talk} disabled={busy}>{busy ? t.talking : t.talk}</Button>
      {reply && (
        <p
          data-testid="speech-bubble"
          className="max-w-full rounded-2xl rounded-tl-none border bg-muted px-3 py-2 text-sm text-foreground"
        >
          {reply}
        </p>
      )}
    </div>
  )
}
