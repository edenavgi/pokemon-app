import type { SpeciesDetail } from '../api/GameApi'

// PokeAPI flavor text contains newlines and form-feeds; collapse to single spaces.
const normalise = (text: string): string => text.replace(/\s+/g, ' ').trim()

export function buildTalkPrompt(s: SpeciesDetail): { system: string; user: string } {
  const system = [
    `You ARE ${s.name}, a Pokémon of type ${s.types.join(' and ')}, talking to your trainer.`,
    `About you: ${normalise(s.flavorText)}`,
    'Reply in 1-2 short lines.',
    `Reply mostly with your signature sound or catchphrase. Pokémon speak by repeating parts of their own name, so ${s.name} says things like "${s.name}, ${s.name}!"`,
    'Stay in character at all times. No narration, no quotation marks, no emojis.',
  ].join('\n')
  return { system, user: 'Your trainer says hi! What do you say?' }
}
