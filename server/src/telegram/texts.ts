// What the bot says. Plain text (no Markdown), so names with * or _ can't break a message.
import type { Pokemon, Status } from '@app/api/GameApi'
import { MAX_ENERGY } from '@app/game/constants'
import { battleErrorText } from '@app/lib/messages'

const list = (names: string[]) => names.join(', ')

export const texts = {
  // linking (Task 9)
  linked: (name: string, accountName: string, userId: string, accountId: string) =>
    `Linked! This chat now plays as ${name} on the ${accountName} account (user ${userId}, account ${accountId}).`,
  badCode: 'That link has expired or was already used. Open Gym HQ → Connect → Connect Telegram to get a new one.',
  notLinked: 'Link your account from the app first: open Gym HQ → Connect → Connect Telegram.',
  noBoards: 'Your Gyms and Pokémon boards are not set yet. Open Gym HQ in monday once, then try again.',
  reconnect: 'The bot lost access to your monday account. Open Gym HQ → Connect → Connect to monday, then try again.',
  oops: 'Something went wrong talking to monday. Please try again in a minute.',

  // commands (Task 10)
  usage: (form: string) => `Usage: ${form}`,
  noGyms: 'No gyms yet. Create one in Gym HQ.',
  emptyRoster: (gym: string) => `${gym} has no Pokémon yet.`,
  unknownGym: (query: string, names: string[]) =>
    names.length ? `No gym called "${query}". Your gyms: ${list(names)}.` : `No gym called "${query}". You have no gyms yet.`,
  ambiguousGym: (query: string, names: string[]) => `"${query}" could be ${list(names)}. Type more of the name.`,
  ambiguousSplit: 'I can read those gym names in more than one way. Put names with spaces in quotes, like /battle "Cinnabar Gym" Cerulean',
  noSplit: 'I could not find two gyms there. Put names with spaces in quotes, like /battle "Cinnabar Gym" Cerulean',
  unknownPokemon: (query: string) => `No Pokémon called "${query}".`,
  ambiguousPokemon: (matches: Pokemon[]) =>
    ['More than one Pokémon matches. Use the id:',
      ...matches.map((p) => `${p.name} (${p.gym?.name ?? 'no gym'}, Lv ${p.level}, id ${p.id})`)].join('\n'),

  // writes (Task 11)
  trained: (p: Pick<Pokemon, 'name' | 'level' | 'energy' | 'status'>) =>
    `${p.name}: Lv ${p.level} — ${p.status} — ⚡${p.energy}/${MAX_ENERGY}`,
  canEvolve: (name: string, target: string) => `${name} can evolve into ${target}! Evolve it in Gym HQ (Status & Evolve).`,
  rested: (p: Pick<Pokemon, 'name' | 'level' | 'energy' | 'status'>) =>
    `${p.name} rested: Lv ${p.level} — ${p.status} — ⚡${p.energy}/${MAX_ENERGY}`,
  cantRest: (name: string, status: Status) => `${name} is ${status}. Only a Resting Pokémon can rest.`,

  // battles (Task 15)
  battleStarted: (a: string, b: string) => `⚔️ Battle started: ${a} vs ${b}… I'll send the result here.`,
  battleFailed: (a: string, b: string, error: string) => `${a} vs ${b}: the battle couldn't run. ${failReason(error)}`,
} as const

function failReason(error: string): string {
  if (error === 'A_NOT_ELIGIBLE' || error === 'B_NOT_ELIGIBLE' || error === 'SAME_GYM') return battleErrorText(error)
  if (error === 'QUOTA') return 'The server reached its daily limit. Try again tomorrow.'
  return 'Please try again in a minute.'
}
