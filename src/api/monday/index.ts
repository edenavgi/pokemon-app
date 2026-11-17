import mondaySdk from 'monday-sdk-js'
import type { AppContext, GameApi, ThemeName } from '../GameApi'

const monday = mondaySdk()

// Placeholder for methods we haven't implemented yet
function notYet(name: string): never {
  throw new Error(`${name}: not implemented yet`)
}

export function createMondayGameApi(): GameApi {
  const api: GameApi = {
    async getContext(): Promise<AppContext> {
      const res = await monday.get('context')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = res.data as any

      // 👇//
      return {
        theme: data.theme as ThemeName,
        boardId: data.boardId != null ? String(data.boardId) : undefined,
        itemId: data.itemId != null ? String(data.itemId) : undefined,
        columnId: data.columnId != null ? String(data.columnId) : undefined,
        selectedItemIds: data.selectedPulsesIds?.map(String),
        widgetBoardIds: data.boardIds?.map(String),
      }
    },

    onContextChange: () => notYet('onContextChange'),
    onItemChanged: () => notYet('onItemChanged'),
    listBoards: () => notYet('listBoards'),
    getBoardConfig: () => notYet('getBoardConfig'),
    setBoardConfig: () => notYet('setBoardConfig'),
    getPokemon: () => notYet('getPokemon'),
    getPokemonMany: () => notYet('getPokemonMany'),
    listPokemon: () => notYet('listPokemon'),
    listGyms: () => notYet('listGyms'),
    getGym: () => notYet('getGym'),
    createGym: () => notYet('createGym'),
    recruit: () => notYet('recruit'),
    updatePokemon: () => notYet('updatePokemon'),
    setGym: () => notYet('setGym'),
    postUpdate: () => notYet('postUpdate'),
    notify: () => notYet('notify'),
    closeFeature: () => notYet('closeFeature'),
    listGen1: () => notYet('listGen1'),
    getSpecies: () => notYet('getSpecies'),
    getEvolution: () => notYet('getEvolution'),
    getTypeChart: () => notYet('getTypeChart'),
    talk: () => notYet('talk'),
  }
return api
}
