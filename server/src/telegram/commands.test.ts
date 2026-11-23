import { describe, expect, it } from 'vitest'
import { sparErrorText } from '@app/lib/messages'
import { telegramSetup as setup } from '../../test/telegramHarness'
import { BOT_COMMANDS, helpText } from './commands'
import { texts } from './texts'

// Fixture boards (src/api/mock/fixtures.ts via fakeMonday): Cinnabar Gym (Fire) has Charmander Lv 5 Ready ⚡3
// and Charmeleon Lv 18 Training ⚡2; Cerulean Gym (Water) has 2, Celadon Gym (Grass) has 6.

describe('/gyms', () => {
  it('lists every gym with type and count', async () => {
    const { linkedChat, say, repliesTo } = await setup()
    await linkedChat()
    await say('555', '/gyms')
    expect(repliesTo('555')).toEqual([[
      'Cinnabar Gym — Fire — 2 Pokémon',
      'Cerulean Gym — Water — 2 Pokémon',
      'Celadon Gym — Grass — 6 Pokémon',
    ].join('\n')])
  })

  it('says so when there are no gyms', async () => {
    const { linkedChat, say, repliesTo, monday } = await setup()
    await linkedChat()
    monday.gyms.clear()
    await say('555', '/gyms')
    expect(repliesTo('555')).toEqual([texts.noGyms])
  })
})

describe('/roster', () => {
  it('/roster Cinnabar lists level, status and energy', async () => {
    const { linkedChat, say, repliesTo } = await setup()
    await linkedChat()
    await say('555', '/roster Cinnabar')
    expect(repliesTo('555')).toEqual([[
      'Cinnabar Gym (Fire)',
      'Charmander — Lv 5 — Ready — ⚡3/3',
      'Charmeleon — Lv 18 — Training — ⚡2/3',
    ].join('\n')])
  })

  it('takes the full name with "Gym" and any case', async () => {
    const { linkedChat, say, repliesTo } = await setup()
    await linkedChat()
    await say('555', '/roster cerulean GYM')
    expect(repliesTo('555')[0]).toMatch(/^Cerulean Gym \(Water\)\nSquirtle/)
  })

  it('without args → usage', async () => {
    const { linkedChat, say, repliesTo } = await setup()
    await linkedChat()
    await say('555', '/roster')
    expect(repliesTo('555')).toEqual([texts.usage('/roster <gym>')])
  })

  it('an unknown gym → the unknown-gym reply with the names', async () => {
    const { linkedChat, say, repliesTo } = await setup()
    await linkedChat()
    await say('555', '/roster nope')
    expect(repliesTo('555')).toEqual([texts.unknownGym('nope', ['Cinnabar Gym', 'Cerulean Gym', 'Celadon Gym'])])
  })
})

describe('the command router', () => {
  it('/help, an unknown command and plain text → the help text listing the commands', async () => {
    const { linkedChat, say, repliesTo } = await setup()
    await linkedChat()
    for (const text of ['/help', '/dance', 'hi there', '/start']) await say('555', text)
    expect(repliesTo('555')).toEqual([helpText(), helpText(), helpText(), helpText()])
    for (const c of BOT_COMMANDS) expect(helpText()).toContain(`/${c.command}`)
  })

  it('BOT_COMMANDS (the Telegram menu) has gyms, roster, train, rest and help, in Telegram\'s format', () => {
    expect(BOT_COMMANDS.map((c) => c.command)).toEqual(['gyms', 'roster', 'train', 'rest', 'help'])
    for (const c of BOT_COMMANDS) {
      expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/)
      expect(c.description.length).toBeGreaterThanOrEqual(1)
      expect(c.description.length).toBeLessThanOrEqual(256)
    }
  })

  it('reads live: the gateway is called on each command (no caching of board data)', async () => {
    const { linkedChat, say, repliesTo, mondayRequests, monday } = await setup()
    await linkedChat()
    await say('555', '/gyms')
    const after1 = mondayRequests()
    expect(after1).toBeGreaterThan(0)
    monday.gyms.delete('g3') // someone deletes Celadon Gym on the board
    await say('555', '/gyms')
    expect(mondayRequests()).toBeGreaterThan(after1)
    expect(repliesTo('555')[1]).not.toContain('Celadon')
  })

  it('the reply is sent inline from the webhook request; nothing is published to the queue', async () => {
    const { linkedChat, say, sent, queue } = await setup()
    await linkedChat()
    const res = await say('555', '/gyms')
    expect(res.status).toBe(200)
    expect(sent).toHaveLength(1) // already sent when the webhook answered
    expect(queue.published).toEqual([])
  })

  it('an unlinked chat still gets notLinked, whatever the command', async () => {
    const { say, repliesTo } = await setup()
    await say('555', '/roster cinnabar')
    expect(repliesTo('555')).toEqual([texts.notLinked])
  })

  it('a monday error → a friendly reply, and the error is on the event', async () => {
    const { linkedChat, say, repliesTo, monday, log } = await setup()
    await linkedChat()
    monday.failNextReads(1)
    await say('555', '/gyms')
    expect(repliesTo('555')).toEqual([texts.oops])
    expect(log.events().find((e) => e.path === '/telegram/webhook')).toMatchObject({ command: '/gyms', error: { message: expect.any(String) } })
  })

  it('the monday token was revoked → reconnect reply', async () => {
    const { linkedChat, say, repliesTo, tokens } = await setup()
    await linkedChat()
    await tokens.save('101', { accessToken: 'x', refreshToken: 'r', exp: 0 }) // expired; refresh fails with invalid_grant
    await say('555', '/gyms')
    expect(repliesTo('555')).toEqual([texts.reconnect])
  })
})

// Fixture Pokémon: Cinnabar Gym — Charmander p1 (Lv 5, ⚡3, Ready, stage 1) and Charmeleon p2 (Lv 18, ⚡2, Training, stage 2);
// Cerulean Gym — Squirtle p3 (Lv 7, ⚡3, Ready) and Wartortle p4 (Lv 16, ⚡1, Resting).
describe('/train', () => {
  it('two Pokémon in the same gym → both level +1, energy −1, deriveStatus, in ONE board write', async () => {
    const { linkedChat, say, repliesTo, monday } = await setup()
    await linkedChat()
    await say('555', '/train charmander charmeleon')
    expect(monday.pokemon.get('p1')).toMatchObject({ level: 6, energy: 2, status: 'Ready' })
    expect(monday.pokemon.get('p2')).toMatchObject({ level: 19, energy: 1, status: 'Ready' })
    expect(monday.writeCalls()).toBe(1)
    const reply = repliesTo('555')[0]
    expect(reply).toContain(texts.trained(monday.pokemon.get('p1')!))
    expect(reply).toContain(texts.trained(monday.pokemon.get('p2')!))
  })

  it('reaching the evolve level (3 at stage 1) mentions it can evolve; below it, nothing', async () => {
    const { linkedChat, say, repliesTo, monday } = await setup()
    await linkedChat()
    monday.pokemon.get('p1')!.level = 2 // Charmander → 3: can evolve into Charmeleon
    await say('555', '/train charmander charmeleon')
    expect(repliesTo('555')[0]).toContain(texts.canEvolve('Charmander', 'Charmeleon'))

    monday.pokemon.get('p1')!.level = 0 // → 1: not yet
    await say('555', '/train charmander charmeleon')
    expect(repliesTo('555')[1]).not.toContain(texts.canEvolve('Charmander', 'Charmeleon'))
  })

  it('across gyms → sparErrorText(DIFFERENT_GYMS) and no write', async () => {
    const { linkedChat, say, repliesTo, monday } = await setup()
    await linkedChat()
    await say('555', '/train charmander squirtle')
    expect(repliesTo('555')).toEqual([sparErrorText('DIFFERENT_GYMS')])
    expect(monday.writeCalls()).toBe(0)
  })

  it('a Resting partner → the v1 text and no write', async () => {
    const { linkedChat, say, repliesTo, monday } = await setup()
    await linkedChat()
    await say('555', '/train squirtle wartortle')
    expect(repliesTo('555')).toEqual([sparErrorText('RESTING', ['Wartortle'])])
    expect(monday.writeCalls()).toBe(0)
  })

  it('a 0-energy partner → the v1 text and no write', async () => {
    const { linkedChat, say, repliesTo, monday } = await setup()
    await linkedChat()
    monday.pokemon.get('p2')!.energy = 0
    await say('555', '/train charmander charmeleon')
    expect(repliesTo('555')).toEqual([sparErrorText('NO_ENERGY', ['Charmeleon'])])
    expect(monday.writeCalls()).toBe(0)
  })

  it('validates the values read just before writing, not the ones the names were matched on', async () => {
    const { linkedChat, say, repliesTo, monday } = await setup()
    await linkedChat()
    // Someone sets Charmeleon to Resting in monday between the name lookup and the check
    let reads = 0
    const realRequest = monday.request
    monday.request = (async (query: string, variables?: Record<string, unknown>) => {
      if (query.includes('items(ids: $itemIds') && ++reads === 1) monday.pokemon.get('p2')!.status = 'Resting'
      return realRequest(query, variables)
    }) as typeof monday.request
    await say('555', '/train charmander charmeleon')
    expect(repliesTo('555')).toEqual([sparErrorText('RESTING', ['Charmeleon'])])
  })

  it('one arg → usage; an unknown name → unknownPokemon', async () => {
    const { linkedChat, say, repliesTo } = await setup()
    await linkedChat()
    await say('555', '/train charmander')
    await say('555', '/train charmander mewtwo')
    expect(repliesTo('555')).toEqual([texts.usage('/train <pokemon> <partner>'), texts.unknownPokemon('mewtwo')])
  })

  it('a duplicate update_id for /train applies once', async () => {
    const { linkedChat, say, monday } = await setup()
    await linkedChat()
    await say('555', '/train charmander charmeleon', { updateId: 42 })
    await say('555', '/train charmander charmeleon', { updateId: 42 })
    expect(monday.pokemon.get('p1')).toMatchObject({ level: 6, energy: 2 })
    expect(monday.writeCalls()).toBe(1)
  })
})

describe('/rest', () => {
  it('on Resting → energy 3, status by level', async () => {
    const { linkedChat, say, repliesTo, monday } = await setup()
    await linkedChat()
    await say('555', '/rest wartortle')
    expect(monday.pokemon.get('p4')).toMatchObject({ energy: 3, status: 'Ready' }) // Lv 16 ≥ 5
    expect(repliesTo('555')).toEqual([texts.rested(monday.pokemon.get('p4')!)])
  })

  it('on Ready → cantRest and no write', async () => {
    const { linkedChat, say, repliesTo, monday } = await setup()
    await linkedChat()
    await say('555', '/rest charmander')
    expect(repliesTo('555')).toEqual([texts.cantRest('Charmander', 'Ready')])
    expect(monday.writeCalls()).toBe(0)
  })

  it('without args → usage', async () => {
    const { linkedChat, say, repliesTo } = await setup()
    await linkedChat()
    await say('555', '/rest')
    expect(repliesTo('555')).toEqual([texts.usage('/rest <pokemon>')])
  })
})
