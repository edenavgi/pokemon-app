import type { EvoBlock } from '../game/evolution'
import type { JoinError } from '../game/roster'
import type { SparError } from '../game/status'

// All user-facing copy lives here. Switches are exhaustive on purpose (no default).

function list(names?: string[], fallback = 'A Pokémon'): string {
  if (!names || names.length === 0) return fallback
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const plural = (names?: string[]) => (names?.length ?? 0) > 1

export function sparErrorText(e: SparError, names?: string[]): string {
  switch (e) {
    case 'NEED_TWO': return 'Pick two Pokémon to spar.'
    case 'DUPLICATE': return 'Pick two different Pokémon.'
    case 'NO_GYM': return `${list(names)} ${plural(names) ? 'need' : 'needs'} a gym before sparring.`
    case 'DIFFERENT_GYMS': return 'Sparring partners must be in the same gym.'
    case 'NO_ENERGY': return `${list(names)} ${plural(names) ? 'have no energy left — let them' : 'has no energy left — let it'} rest first.`
    case 'RESTING': return `${list(names)} ${plural(names) ? 'are' : 'is'} resting right now.`
  }
}

export function joinErrorText(e: JoinError | 'DUPLICATE', names?: string[]): string {
  switch (e) {
    case 'TYPE_MISMATCH': return `${list(names)} ${plural(names) ? "don't" : "doesn't"} match this gym's type.`
    case 'ROSTER_FULL': return 'That gym roster is full.'
    case 'GYM_HAS_NO_TYPE': return 'That gym has no type yet — give it one first.'
    case 'DUPLICATE': return `${list(names)} ${plural(names) ? 'are' : 'is'} already in that gym.`
  }
}

export function evoBlockText(reason: EvoBlock, atLevel?: number): string {
  switch (reason) {
    case 'MAX_STAGE': return 'Already fully evolved.'
    case 'NO_LEVEL_EVOLUTION': return "This one doesn't evolve by levelling up."
    case 'BRANCHING': return 'Has several possible evolutions — not supported yet.'
    case 'OUTSIDE_GEN1': return 'Its evolution is outside Generation 1.'
    case 'LEVEL_TOO_LOW': return atLevel === undefined ? 'Not high enough level yet.' : `Evolves at level ${atLevel}`
  }
}

export function battleErrorText(e: 'A_NOT_ELIGIBLE' | 'B_NOT_ELIGIBLE' | 'SAME_GYM'): string {
  switch (e) {
    case 'A_NOT_ELIGIBLE': return 'The first gym has no Pokémon ready to battle.'
    case 'B_NOT_ELIGIBLE': return 'The second gym has no Pokémon ready to battle.'
    case 'SAME_GYM': return 'Pick two different gyms.'
  }
}

export function talkFallbackText(name: string): string {
  return `${name} is napping right now. Try again later.`
}

export const boardViewText = {
  gym: 'Gym', filterByStatus: 'Filter by status', all: 'All',
  noGyms: 'No gyms on this board yet',
  emptyGym: 'No Pokémon in this gym yet',
  emptyFilter: 'No Pokémon with this status',
} as const

export const widgetText = {
  noBoards: 'Connect the Gyms and/or Pokémon board in widget settings',
  connectPokemon: 'Connect the Pokémon board to see status',
  gym: 'Gym', pokemon: 'Pokémon', avgLevel: 'Avg level', byStatus: 'By status',
  noAvg: '—',
} as const

export const itemViewText = {
  notInItem: 'Open this view inside a Pokémon item',
  level: 'Level', energy: 'Energy', gym: 'Gym', noGym: 'No gym',
  hp: 'HP', attack: 'Attack', defense: 'Defense', speed: 'Speed',
  talk: 'Talk', talking: 'Talking…',
} as const

export const selectionText = {
  notLoaded: 'Some selected items could not be loaded. Refresh the board and try again.',
  wrongBoard: 'Open this action on the Pokémon board.',
} as const

export const sparText = {
  title: 'Spar',
  level: 'Level', energy: 'Energy', status: 'Status',
  confirm: 'Confirm', saving: 'Saving…',
  success: (a: string, b: string) => `${a} and ${b} sparred: +1 level, -1 energy each.`,
} as const

export const transferText = {
  title: 'Transfer to gym',
  noSelection: 'Select Pokémon on the board first',
  noGyms: 'No gyms to transfer to',
  nothingToMove: 'Nothing to move',
  gymMeta: (type: string | null, count: number) => `${type ?? 'No type'} · ${count} Pokémon`,
  success: (names: string[], gym: string) => `Moved ${list(names)} to ${gym}.`,
} as const

export const statusDialogText = {
  title: 'Change status',
  notInItem: 'Open this view from a Pokémon status cell',
  moveTo: (status: string) => `Move to ${status}`,
  rest: 'Rest',
  evolve: 'Evolve',
  evolving: 'Evolving…',
  evolveTo: (name: string) => `→ ${name}`,
  evoLoadFailed: 'Could not check evolution right now.',
  statusSuccess: (name: string, status: string) => `${name} is now ${status}.`,
  restSuccess: (name: string) => `${name} rested and is ready to go again.`,
  evolveSuccess: (from: string, to: string) => `${from} evolved into ${to}!`,
  updateFailed: 'Evolved, but could not post the update on the item.',
} as const
