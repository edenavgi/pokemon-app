// The battle result card (Phase 2, Task 16 — an experiment). Two steps, like a print shop:
//   1. satori: a layout (plain { type, props } objects, like HTML + inline CSS) → an SVG
//   2. resvg (WebAssembly build, Eden's choice — no native binary to install): the SVG → a PNG
// The server has no browser, so this is how it "draws". Any failure here is the caller's to swallow:
// the card is best effort and never fails a battle.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { initWasm, Resvg } from '@resvg/resvg-wasm'
import satori from 'satori'
import { currentEvent } from '../log/wideEvent'

export const CARD_WIDTH = 800
export const CARD_HEIGHT = 418
const SPRITE_TIMEOUT_MS = 3000
const PAD = 40

export interface CardInput {
  gymA: string
  gymB: string
  /** The winning gym's name; null on a draw */
  winner: string | null
  turns: number
  mvp: { name: string; spriteUrl?: string } | null
}

// npm packages stay outside the bundle (esbuild packages: 'external'), so their files resolve from node_modules
const require = createRequire(import.meta.url)

// Loaded once per process. satori reads .woff (not .woff2); the WebAssembly may be set up only once.
let ready: Promise<{ font: Buffer }> | undefined
function setup(): Promise<{ font: Buffer }> {
  ready ??= (async () => {
    const [font, wasm] = await Promise.all([
      readFile(require.resolve('@fontsource/inter/files/inter-latin-700-normal.woff')),
      readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm')),
    ])
    await initWasm(wasm)
    return { font }
  })()
  ready.catch(() => (ready = undefined)) // a failed setup may be tried again by the next card
  return ready
}

/** The sprite as a data: URL, or undefined (the card then shows the name only). */
async function loadSprite(url: string, fetchImpl: typeof fetch): Promise<string | undefined> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(SPRITE_TIMEOUT_MS) })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok || !type.startsWith('image/')) throw new Error(`HTTP ${res.status} ${type}`)
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
  } catch (err) {
    currentEvent()?.set({ spriteFailed: err instanceof Error ? err.message : String(err) })
    return undefined
  }
}

type Node = { type: string; props: Record<string, unknown> & { style?: Record<string, unknown>; children?: unknown } }
const h = (type: string, style: Record<string, unknown>, children?: unknown, props: Record<string, unknown> = {}): Node =>
  ({ type, props: { ...props, style, ...(children === undefined ? {} : { children }) } })

function layout(c: CardInput, sprite: string | undefined): Node {
  const result = c.winner ? `${c.winner} wins` : 'Draw'
  return h('div', {
    // satori adds padding OUTSIDE width/height (content-box), so the box is the card minus the padding
    width: CARD_WIDTH - 2 * PAD, height: CARD_HEIGHT - 2 * PAD, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    padding: PAD, color: '#ffffff', fontFamily: 'Inter',
    backgroundImage: 'linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%)',
  }, [
    h('div', { display: 'flex', fontSize: 22, opacity: 0.8 }, 'ARENA RESULT'),
    h('div', { display: 'flex', flexDirection: 'column' }, [
      h('div', { display: 'flex', fontSize: `${c.gymA} vs ${c.gymB}`.length > 30 ? 30 : 40 }, `${c.gymA}  vs  ${c.gymB}`),
      h('div', { display: 'flex', fontSize: 56, color: '#fde047', marginTop: 12 }, result),
    ]),
    h('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, [
      h('div', { display: 'flex', alignItems: 'center' }, c.mvp
        ? [
            ...(sprite ? [h('img', { width: 96, height: 96, marginRight: 12 }, undefined, { src: sprite, width: 96, height: 96 })] : []),
            h('div', { display: 'flex', fontSize: 30 }, `MVP ${c.mvp.name}`),
          ]
        : [h('div', { display: 'flex', fontSize: 30, opacity: 0.8 }, 'No MVP')]),
      h('div', { display: 'flex', fontSize: 24, opacity: 0.8 }, `${c.turns} ${c.turns === 1 ? 'turn' : 'turns'}`),
    ]),
  ])
}

/** The card as PNG bytes. `fetchImpl` is for the MVP sprite only. */
export async function renderBattleCard(c: CardInput, opts: { fetchImpl?: typeof fetch } = {}): Promise<Buffer> {
  const fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args))
  const [{ font }, sprite] = await Promise.all([
    setup(),
    c.mvp?.spriteUrl ? loadSprite(c.mvp.spriteUrl, fetchImpl) : Promise.resolve(undefined),
  ])
  const svg = await satori(layout(c, sprite) as Parameters<typeof satori>[0], {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts: [{ name: 'Inter', data: font, weight: 700, style: 'normal' }],
  })
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng())
}
