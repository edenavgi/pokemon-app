import { describe, expect, it, vi } from 'vitest'
import { MockGameApi } from './MockGameApi'

const make = (opts?: ConstructorParameters<typeof MockGameApi>[0]) => new MockGameApi(opts)

describe('MockGameApi', () => {
  it('recruit creates level 1 / energy 3 / Recruited linked to the gym', async () => {
    const api = make()
    const species = await api.getSpecies(4)
    const p = await api.recruit({ species, gymId: 'g1' })
    expect(p).toMatchObject({ level: 1, energy: 3, status: 'Recruited', dexNumber: 4, name: 'Charmander' })
    expect(p.gym?.id).toBe('g1')
    const gym = await api.getGym('g1')
    expect(gym.roster.map((r) => r.id)).toContain(p.id)
    expect(gym.mirroredLevels).toEqual(gym.roster.map((r) => r.level))
  })

  it('updatePokemon updates the pokemon and fires onItemChanged exactly once', async () => {
    const api = make()
    const cb = vi.fn()
    api.onItemChanged('p1', cb)
    await api.updatePokemon([{ id: 'p1', patch: { level: 4 } }])
    expect((await api.getPokemon('p1')).level).toBe(4)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('unsubscribe stops callbacks', async () => {
    const api = make()
    const cb = vi.fn()
    const off = api.onItemChanged('p1', cb)
    off()
    await api.updatePokemon([{ id: 'p1', patch: { level: 4 } }])
    expect(cb).not.toHaveBeenCalled()
  })

  it('setGym moves pokemon between rosters and mirroredLevels follows', async () => {
    const api = make()
    const cb = vi.fn()
    api.onItemChanged('p1', cb)
    await api.setGym(['p1'], 'g2')
    const g1 = await api.getGym('g1')
    const g2 = await api.getGym('g2')
    expect(g1.roster.map((p) => p.id)).not.toContain('p1')
    expect(g2.roster.map((p) => p.id)).toContain('p1')
    expect(g2.mirroredLevels).toEqual(g2.roster.map((p) => p.level))
    expect((await api.getPokemon('p1')).gym?.id).toBe('g2')
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('mirroredLevels is never stale after a level change', async () => {
    const api = make()
    await api.updatePokemon([{ id: 'p1', patch: { level: 9 } }])
    const g1 = await api.getGym('g1')
    expect(g1.mirroredLevels[0]).toBe(9)
  })

  it('listPokemon filters by status, gym and ids', async () => {
    const api = make()
    const ready = await api.listPokemon({ status: 'Ready' })
    expect(ready.length).toBeGreaterThan(0)
    expect(ready.every((p) => p.status === 'Ready')).toBe(true)
    const inG2 = await api.listPokemon({ gymId: 'g2' })
    expect(inG2.every((p) => p.gym?.id === 'g2')).toBe(true)
    expect((await api.getPokemonMany(['p1', 'p3'])).map((p) => p.id)).toEqual(['p1', 'p3'])
  })

  it('fixtures cover edge cases', async () => {
    const api = make()
    const gyms = await api.listGyms()
    expect(gyms.map((g) => g.name)).toEqual(expect.arrayContaining(['Cinnabar Gym', 'Cerulean Gym']))
    expect(gyms.some((g) => g.type === 'Grass' && g.roster.length === 6)).toBe(true)
    const all = await api.listPokemon()
    expect(all.some((p) => p.energy === 0)).toBe(true)
    expect(all.some((p) => p.gym === null)).toBe(true)
    expect((await api.getSpecies(81)).types).toEqual(['Electric', 'Steel'])
    expect((await api.getEvolution(42)).next[0].dexNumber).toBe(169)
    expect((await api.getEvolution(133)).next.length).toBeGreaterThan(1)
    expect((await api.getEvolution(6)).next).toEqual([])
    expect((await api.getEvolution(25)).next[0]).toMatchObject({ trigger: 'other', minLevel: null })
    expect((await api.getTypeChart()).Water.Fire).toBe(2)
    expect((await api.listGen1()).length).toBeGreaterThan(0)
    for (const s of await api.listGen1()) {
      for (const n of (await api.getEvolution(s.dexNumber)).next) {
        if (n.dexNumber <= 151) await expect(api.getSpecies(n.dexNumber)).resolves.toBeTruthy()
      }
    }
  })

  it('createGym adds an empty gym', async () => {
    const api = make()
    const g = await api.createGym({ name: 'Pewter Gym', type: 'Rock' })
    expect(g.roster).toEqual([])
    expect((await api.listGyms()).map((x) => x.id)).toContain(g.id)
  })

  it('talk returns text; failTalk rejects', async () => {
    expect((await make().talk({ system: 's', user: 'u' })).length).toBeGreaterThan(0)
    await expect(make({ failTalk: true }).talk({ system: 's', user: 'u' })).rejects.toThrow('run_prompt failed')
  })

  it('records notices and updates', async () => {
    const api = make()
    api.notify('hi', 'success')
    await api.postUpdate('p1', 'body')
    expect(api.notices).toEqual([{ message: 'hi', type: 'success' }])
    expect(api.updates).toEqual([{ itemId: 'p1', body: 'body' }])
  })

  it('board config and context', async () => {
    const api = make({ context: { itemId: 'p1' } })
    expect(await api.getBoardConfig()).toBeNull()
    await api.setBoardConfig({ gymsBoardId: 'b1', pokemonBoardId: 'b2' })
    expect(await api.getBoardConfig()).toEqual({ gymsBoardId: 'b1', pokemonBoardId: 'b2' })
    expect((await api.listBoards()).length).toBe(2)
    expect(await api.getContext()).toEqual({ theme: 'light', itemId: 'p1' })
    const cb = vi.fn()
    api.onContextChange(cb)
    api.setContext({ theme: 'dark' })
    expect(cb).toHaveBeenCalledWith({ theme: 'dark', itemId: 'p1' })
    expect((await api.getContext()).theme).toBe('dark')
  })

  it('honours delayMs', async () => {
    vi.useFakeTimers()
    const api = make({ delayMs: 50 })
    let done = false
    void api.getPokemon('p1').then(() => { done = true })
    await vi.advanceTimersByTimeAsync(10)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(60)
    expect(done).toBe(true)
    vi.useRealTimers()
  })
})
