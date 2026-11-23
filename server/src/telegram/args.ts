// Turning what the user typed into a command, and names into board items (plan Design decision 8).
import type { Gym, Pokemon } from '@app/api/GameApi'
import { texts } from './texts'

/** "/roster@eden_gym_bot Cinnabar Gym" → { name: 'roster', args: ['Cinnabar', 'Gym'] }; plain text → null. */
export function parseCommand(text: string, botUsername: string): { name: string; args: string[] } | null {
  // Quotes group words. Phones often turn " into “ ”, so those count too.
  const tokens = [...text.trim().matchAll(/["“”]([^"“”]*)["“”]|(\S+)/g)].map((m) => m[1] ?? m[2])
  const [first, ...args] = tokens
  if (!first?.startsWith('/')) return null
  const [name, bot] = first.slice(1).split('@')
  if (bot && bot.toLowerCase() !== botUsername.toLowerCase()) return null // meant for another bot
  return { name: name.toLowerCase(), args: args.filter((a) => a !== '') }
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
const gymKey = (s: string) => norm(s).replace(/ gym$/, '')

/** Exact matches first; then a prefix that fits exactly one. */
function pick<T>(items: T[], key: (t: T) => string, query: string): T[] {
  const exact = items.filter((t) => key(t) === query)
  return exact.length ? exact : items.filter((t) => key(t).startsWith(query))
}

/** A gym by name: any case, " Gym" optional, a unique prefix is enough. */
export function matchGym(query: string, gyms: Gym[]): { ok: true; gym: Gym } | { ok: false; reply: string } {
  const q = gymKey(query)
  const found = q ? pick(gyms, (g) => gymKey(g.name), q) : []
  if (found.length === 1) return { ok: true, gym: found[0] }
  if (found.length > 1) return { ok: false, reply: texts.ambiguousGym(query, found.map((g) => g.name)) }
  return { ok: false, reply: texts.unknownGym(query, gyms.map((g) => g.name)) }
}

/**
 * Two gyms from the words after /battle. Quoted names arrive as one arg. Otherwise every split
 * point is tried, and exactly one split where both halves are gyms must exist.
 */
export function splitTwoGyms(args: string[], gyms: Gym[]): { ok: true; a: Gym; b: Gym } | { ok: false; reply: string } {
  if (args.length < 2) return { ok: false, reply: texts.usage('/battle <gym> <gym>') }
  const found: { a: Gym; b: Gym }[] = []
  for (let i = 1; i < args.length; i++) {
    const a = matchGym(args.slice(0, i).join(' '), gyms)
    const b = matchGym(args.slice(i).join(' '), gyms)
    if (a.ok && b.ok) found.push({ a: a.gym, b: b.gym })
  }
  if (found.length === 1) return { ok: true, ...found[0] }
  return { ok: false, reply: found.length > 1 ? texts.ambiguousSplit : texts.noSplit }
}

/** A Pokémon by item ID (all digits) or by name (any case, unique prefix). Same names → list them with ids. */
export function matchPokemon(query: string, pokemon: Pokemon[]): { ok: true; p: Pokemon } | { ok: false; reply: string } {
  if (/^\d+$/.test(query.trim())) {
    const p = pokemon.find((x) => x.id === query.trim())
    return p ? { ok: true, p } : { ok: false, reply: texts.unknownPokemon(query) }
  }
  const q = norm(query)
  const found = q ? pick(pokemon, (p) => norm(p.name), q) : []
  if (found.length === 1) return { ok: true, p: found[0] }
  if (found.length > 1) return { ok: false, reply: texts.ambiguousPokemon(found) }
  return { ok: false, reply: texts.unknownPokemon(query) }
}
