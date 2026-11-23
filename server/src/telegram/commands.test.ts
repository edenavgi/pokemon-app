import { describe, expect, it } from 'vitest'
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

  it('BOT_COMMANDS (the Telegram menu) has gyms, roster and help, in Telegram\'s format', () => {
    expect(BOT_COMMANDS.map((c) => c.command)).toEqual(['gyms', 'roster', 'help'])
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
