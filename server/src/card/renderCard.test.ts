import { describe, expect, it, vi } from 'vitest'
import { renderBattleCard } from './renderCard'

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const isPng = (b: Buffer) => PNG_MAGIC.every((byte, i) => b[i] === byte)
/** PNG IHDR: width at byte 16, height at byte 20 (big-endian). */
const size = (b: Buffer) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) })

// A real 1×1 PNG, as the sprite server would answer
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const spriteFetch = (ok = true) =>
  vi.fn(async () => (ok ? new Response(PIXEL, { headers: { 'Content-Type': 'image/png' } }) : new Response('nope', { status: 404 })))

const input = {
  gymA: 'Cinnabar Gym', gymB: 'Cerulean Gym', winner: 'Cinnabar Gym', turns: 12,
  mvp: { name: 'Charmander', spriteUrl: 'https://sprites.example/4.png' },
}

describe('renderBattleCard', () => {
  it('returns an 800×418 PNG under 10 MB', async () => {
    const png = await renderBattleCard(input, { fetchImpl: spriteFetch() })
    expect(isPng(png)).toBe(true)
    expect(size(png)).toEqual({ width: 800, height: 418 })
    expect(png.length).toBeLessThan(10 * 1024 * 1024)
  })

  it('fetches the MVP sprite from its URL', async () => {
    const fetchImpl = spriteFetch()
    await renderBattleCard(input, { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledWith('https://sprites.example/4.png', expect.anything())
  })

  it('a sprite that cannot be fetched → still a PNG (the name only)', async () => {
    const png = await renderBattleCard(input, { fetchImpl: spriteFetch(false) })
    expect(isPng(png)).toBe(true)
    const thrown = await renderBattleCard(input, { fetchImpl: vi.fn(async () => { throw new Error('offline') }) })
    expect(isPng(thrown)).toBe(true)
  })

  it('draws a draw and a battle with no MVP', async () => {
    const fetchImpl = spriteFetch()
    const png = await renderBattleCard({ ...input, winner: null, mvp: null }, { fetchImpl })
    expect(isPng(png)).toBe(true)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('a second card in the same process works (the WebAssembly is set up once)', async () => {
    const [a, b] = await Promise.all([
      renderBattleCard(input, { fetchImpl: spriteFetch() }),
      renderBattleCard({ ...input, gymA: 'Celadon Gym' }, { fetchImpl: spriteFetch() }),
    ])
    expect(isPng(a) && isPng(b)).toBe(true)
  })
})
