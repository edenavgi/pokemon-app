// Arena battles on the server (Phase 2, Task 7).
//
//   POST /api/battles ─► startBattle: check the gyms, INSERT the battle (queued, seed) ─► publish {battleId}
//   monday code Queue ─► POST /mndy-queue ─► runBattleMessage: claim ─► snapshot ─► simulate (turns saved
//                         as they come) ─► board changes ─► update post ─► done
//
// The queue delivers AT LEAST once, so the same message can arrive twice (or again after a crash).
// Every step is safe to repeat:
//   - claim:     only one worker can move a battle from queued to running (atomic)
//   - snapshot:  the pre-battle Energy/teams are saved once; a retry reuses them, never re-reads the board
//   - seed:      the same seed gives the same battle, and turns have fixed ids (<battleId>:<n>), upserted
//   - absolute:  the board gets "Energy = 2", computed from the snapshot, never "Energy − 1" again
//   - flags:     boardAppliedAt / updatePostedAt — a step that already happened is skipped
import { randomInt, randomUUID } from 'node:crypto'
import { createBoardGateway } from '@app/api/boards/gateway'
import type { Id, Status } from '@app/api/GameApi'
import {
  eligibleFighters, simulateArena, toArenaTeam, validateArena,
  type ArenaError, type ArenaOutcome, type ArenaTeam, type ArenaTurn,
} from '@app/game/arena'
import { spriteUrl } from '@app/api/pokeapi/loaders'
import { mulberry32 } from '@app/game/rng'
import { applyBattleFatigue } from '@app/game/status'
import type { Deps } from '../deps'
import { QuotaError } from '../db/mongo'
import { currentEvent } from '../log/wideEvent'
import { cardFileName } from '../card/objectStorage'
import type { CardInput } from '../card/renderCard'
import { CAPTION_MAX, TelegramError } from '../telegram/api'
import { texts } from '../telegram/texts'

export interface BattleDoc {
  _id: string // battleId
  traceId: string // the request that started it: its events and the queue's share this id
  source: 'app' | 'telegram'
  chatId?: string
  userId: Id
  accountId: Id
  gymsBoardId: Id
  gymA: { id: Id; name: string }
  gymB: { id: Id; name: string }
  seed: number
  status: 'queued' | 'running' | 'done' | 'failed'
  claimedAt?: Date
  /** Before the battle, saved once: what fought, with its Energy and status then. */
  snapshot?: {
    pokemon: { id: Id; energy: number; status: Status; dex?: number }[] // dex: Task 16 (the MVP's sprite)
    teams: { a: ArenaTeam; b: ArenaTeam }
  }
  outcome?: ArenaOutcome
  kos?: { n: number; attackerName: string; defenderName: string }[]
  summary?: string
  boardAppliedAt?: Date
  updatePostedAt?: Date
  updateIds?: Id[] // the updates posted in step 4 (the card is attached to them)
  resultSentAt?: Date // Task 15 (Telegram)
  cardAt?: Date // Task 16: the card is in Object storage and attached to the updates
  cardError?: string // Task 16: why there is no card (best effort: the battle still ends)
  error?: string
  createdAt: Date
  finishedAt?: Date
}

/** What the app may see of a battle. */
export type BattleView = Omit<BattleDoc, 'snapshot' | 'seed' | 'userId' | 'claimedAt'>

export function toBattleView(doc: BattleDoc): BattleView {
  const { snapshot: _s, seed: _seed, userId: _u, claimedAt: _c, ...view } = doc
  return view
}

/** The queue message: just the id (everything else is in the battle document). */
export interface BattleMessage {
  v: 1
  battleId: string
  traceId: string
}

/**
 * The /mndy-queue body → our message. Accepts our raw JSON string (the local QueueDev sends it as is)
 * or a Pub/Sub push envelope { message: { data: <base64> } } (the cloud Queue is Google Pub/Sub).
 */
export function parseQueueBody(raw: string): BattleMessage {
  let body: unknown = JSON.parse(raw)
  const data = (body as { message?: { data?: unknown } })?.message?.data
  if (typeof data === 'string') body = JSON.parse(Buffer.from(data, 'base64').toString('utf8'))
  const m = body as Partial<BattleMessage>
  if (m?.v !== 1 || typeof m.battleId !== 'string' || typeof m.traceId !== 'string') {
    throw new Error('not a battle message')
  }
  return { v: 1, battleId: m.battleId, traceId: m.traceId }
}

export type StartError = ArenaError | 'NOT_CONNECTED' | 'NO_BOARDS' | 'UNKNOWN_GYM'

/** What the battle code needs from the outside world. */
export type BattleDeps = Pick<Deps,
  'repos' | 'now' | 'mondayFor' | 'pokeApiFor' | 'queue' | 'telegram' | 'renderCard' | 'objectStorage' | 'mondayFileFor'>

/**
 * Checks the two gyms on the user's board, saves the battle as queued, THEN publishes the message —
 * so when the message arrives, the battle is always there to claim.
 */
export async function startBattle(
  deps: BattleDeps,
  s: { userId: Id; accountId: Id; source: BattleDoc['source']; chatId?: string; gymAId: Id; gymBId: Id; traceId: string },
): Promise<{ battleId: string } | { error: StartError }> {
  const user = await deps.repos.users.get(s.userId)
  if (!user) return { error: 'NOT_CONNECTED' }
  if (!user.gymsBoardId || !user.pokemonBoardId) return { error: 'NO_BOARDS' }
  if (s.gymAId === s.gymBId) return { error: 'SAME_GYM' }

  // Only gyms on this user's own Gyms board, read live
  const gyms = await createBoardGateway(deps.mondayFor(s.userId)).listGyms({ boardIds: [user.gymsBoardId] })
  const gymA = gyms.find((g) => g.id === s.gymAId)
  const gymB = gyms.find((g) => g.id === s.gymBId)
  if (!gymA || !gymB) return { error: 'UNKNOWN_GYM' }
  const valid = validateArena(gymA, gymB)
  if (!valid.ok) return { error: valid.error }

  const battleId = randomUUID()
  await deps.repos.battles.insert({
    _id: battleId,
    traceId: s.traceId,
    source: s.source,
    ...(s.chatId ? { chatId: s.chatId } : {}),
    userId: s.userId,
    accountId: s.accountId,
    gymsBoardId: user.gymsBoardId,
    gymA: { id: gymA.id, name: gymA.name },
    gymB: { id: gymB.id, name: gymB.name },
    seed: randomInt(2 ** 31),
    status: 'queued',
    createdAt: deps.now(),
  })
  const message: BattleMessage = { v: 1, battleId, traceId: s.traceId }
  const messageId = await deps.queue.publishMessage(JSON.stringify(message))
  currentEvent()?.set({ battleId, queueMessageId: messageId })
  return { battleId }
}

/** "Cinnabar Gym vs Cerulean Gym — Cinnabar Gym wins (12 turns, MVP Charmander)", then one line per KO. */
export function battleSummaryText(doc: Pick<BattleDoc, 'gymA' | 'gymB' | 'outcome' | 'kos'>): string {
  const o = doc.outcome!
  const turns = `${o.turnCount} ${o.turnCount === 1 ? 'turn' : 'turns'}`
  const head =
    o.winner === 'draw'
      ? `${doc.gymA.name} vs ${doc.gymB.name} — draw (${turns})`
      : `${doc.gymA.name} vs ${doc.gymB.name} — ${(o.winner === 'A' ? doc.gymA : doc.gymB).name} wins (${turns}${o.mvp ? `, MVP ${o.mvp.name}` : ''})`
  const lines = (doc.kos ?? []).map((k) => `Turn ${k.n}: ${k.attackerName} knocked out ${k.defenderName}`)
  return [head, ...lines].join('\n')
}

/** 4xx from Telegram (except 429): the chat is gone or blocked the bot — sending again can't help. */
function isPermanent(err: unknown): err is TelegramError {
  return err instanceof TelegramError && err.status >= 400 && err.status < 500 && err.status !== 429
}

/**
 * A battle started from Telegram reports back to its chat: the summary, or why it couldn't run.
 * Sent once (resultSentAt). A temporary failure (5xx, 429, network) is thrown, so the queue retries;
 * a permanent one is only logged, and the battle still ends.
 */
export async function onBattleDone(
  deps: Pick<BattleDeps, 'repos' | 'now' | 'telegram'>, doc: BattleDoc, card?: Buffer,
): Promise<void> {
  if (doc.source !== 'telegram' || !doc.chatId || doc.resultSentAt) return
  const chatId = doc.chatId
  const text = doc.error ? texts.battleFailed(doc.gymA.name, doc.gymB.name, doc.error) : battleSummaryText(doc)
  try {
    // Task 16: the card with the summary as its caption, in one message (a caption holds 1024 characters:
    // a longer summary goes as the photo with its first line, then the full text)
    let sent = false
    if (card && !doc.error) {
      try {
        const fits = text.length <= CAPTION_MAX
        await deps.telegram.sendPhoto(chatId, card, fits ? text : text.split('\n')[0])
        if (!fits) await deps.telegram.sendMessage(chatId, text)
        sent = true
      } catch (err) {
        if (!isPermanent(err)) throw err
        currentEvent()?.set({ photoNotSent: err.message }) // e.g. Telegram can't read the image → the text
      }
    }
    if (!sent) await deps.telegram.sendMessage(chatId, text)
    currentEvent()?.set({ resultSent: true })
  } catch (err) {
    if (!isPermanent(err)) throw err
    currentEvent()?.set({ resultNotSent: err.message })
  }
  await deps.repos.battles.update(doc._id, { resultSentAt: deps.now() })
}

/** What the card shows: names, winner, turns and the MVP (its sprite from the snapshot's dex number). */
function cardInput(doc: BattleDoc, outcome: ArenaOutcome, pokemon: { id: Id; dex?: number }[]): CardInput {
  const dex = outcome.mvp ? pokemon.find((p) => p.id === outcome.mvp!.id)?.dex : undefined
  return {
    gymA: doc.gymA.name,
    gymB: doc.gymB.name,
    winner: outcome.winner === 'draw' ? null : (outcome.winner === 'A' ? doc.gymA : doc.gymB).name,
    turns: outcome.turnCount,
    mvp: outcome.mvp ? { name: outcome.mvp.name, ...(dex ? { spriteUrl: spriteUrl(dex) } : {}) } : null,
  }
}

/**
 * Task 16, best effort: draw the card once, store it (cards/<id>.png), attach it to the posted updates.
 * Returns the PNG for Telegram (a retry reads the stored one back). Never throws: any failure is
 * cardError on the event and the battle, and the battle goes on without a card.
 */
async function battleCard(deps: BattleDeps, doc: BattleDoc, outcome: ArenaOutcome, pokemon: { id: Id; dex?: number }[], updateIds: Id[]): Promise<Buffer | undefined> {
  const ev = currentEvent()
  const wantPhoto = doc.source === 'telegram' && !doc.resultSentAt
  if (doc.cardError) return undefined // it failed before: don't try again on a retry
  if (doc.cardAt) return wantPhoto ? ((await deps.objectStorage.download(cardFileName(doc._id)).catch(() => null))?.content) : undefined

  let png: Buffer | undefined
  const fail = async (err: unknown) => {
    const cardError = err instanceof Error ? err.message : String(err)
    ev?.set({ cardError })
    await deps.repos.battles.update(doc._id, { cardError }).catch(() => {})
  }
  try {
    png = await deps.renderCard(cardInput(doc, outcome, pokemon))
    ev?.set({ cardBytes: png.length })
  } catch (err) {
    await fail(err)
    return undefined
  }
  try {
    await deps.objectStorage.upload(cardFileName(doc._id), png, 'image/png')
    const addFile = deps.mondayFileFor(doc.userId)
    for (const updateId of updateIds) await addFile(updateId, png, `battle-${doc._id}.png`)
    await deps.repos.battles.update(doc._id, { cardAt: deps.now() })
  } catch (err) {
    await fail(err) // the PNG itself is fine: Telegram can still have it
  }
  return png
}

/** Turns are written in batches of this size while the battle runs. */
const TURN_BATCH = 10

export type RunResult = 'done' | 'skipped' | 'busy' | 'unknown' | 'failed'

/**
 * Runs one queue message. Safe to call again with the same message (see the top of the file).
 * 'busy' = another delivery is running it right now (the route answers 503, so the queue retries).
 * Any other thrown error gives the battle back (queued) and is rethrown (500 → the queue retries).
 */
export async function runBattleMessage(deps: BattleDeps, msg: BattleMessage): Promise<RunResult> {
  const { repos } = deps
  const id = msg.battleId
  const existing = await repos.battles.get(id)
  if (!existing) return 'unknown'
  if (existing.status === 'done' || existing.status === 'failed') return 'skipped'
  const doc = await repos.battles.claim(id)
  if (!doc) return 'busy'
  const ev = currentEvent()
  ev?.set({ battleId: id, attempt: doc.snapshot ? 'retry' : 'first' })

  try {
    const gateway = createBoardGateway(deps.mondayFor(doc.userId))
    const pokeApi = deps.pokeApiFor(doc.userId)

    // 1. Snapshot (first attempt only): the gyms as they are now, the fighters' Energy, their moves
    let snapshot = doc.snapshot
    if (!snapshot) {
      const [gymA, gymB] = await Promise.all([gateway.getGym(doc.gymA.id), gateway.getGym(doc.gymB.id)])
      const valid = validateArena(gymA, gymB) // the board may have changed since the request
      if (!valid.ok) {
        await onBattleDone(deps, { ...doc, error: valid.error })
        await repos.battles.update(id, { status: 'failed', error: valid.error, finishedAt: deps.now() })
        return 'failed'
      }
      const fighters = [...eligibleFighters(gymA), ...eligibleFighters(gymB)]
      const dexes = [...new Set(fighters.map((p) => p.dexNumber))]
      const movesets = new Map(await Promise.all(dexes.map(async (dex) => [dex, await pokeApi.getMoveset(dex)] as const)))
      snapshot = {
        pokemon: fighters.map((p) => ({ id: p.id, energy: p.energy, status: p.status, dex: p.dexNumber })),
        teams: { a: toArenaTeam(gymA, movesets), b: toArenaTeam(gymB, movesets) },
      }
      await repos.battles.update(id, { snapshot })
    }

    // 2. The battle: same seed + same teams = same turns; they are saved while it runs
    const chart = await pokeApi.getTypeChart()
    const battle = simulateArena(snapshot.teams.a, snapshot.teams.b, chart, mulberry32(doc.seed))
    const kos: NonNullable<BattleDoc['kos']> = []
    let batch: ArenaTurn[] = []
    let outcome: ArenaOutcome
    for (;;) {
      const step = battle.next()
      if (step.done) {
        outcome = step.value
        break
      }
      batch.push(step.value)
      if (step.value.fainted) kos.push({ n: step.value.n, attackerName: step.value.attackerName, defenderName: step.value.defenderName })
      if (batch.length >= TURN_BATCH) {
        await repos.battleTurns.upsertMany(id, batch)
        batch = []
      }
    }
    await repos.battleTurns.upsertMany(id, batch)
    const summary = battleSummaryText({ ...doc, outcome, kos })
    await repos.battles.update(id, { outcome, kos, summary })
    ev?.set({ turns: outcome.turnCount, winner: outcome.winner, endedBy: outcome.endedBy })

    // 3. The board: Energy −1 for every fighter, computed from the snapshot (absolute values)
    if (!doc.boardAppliedAt) {
      const fought = new Set(outcome.fought)
      const patches = snapshot.pokemon.filter((p) => fought.has(p.id)).map((p) => ({ id: p.id, patch: applyBattleFatigue(p) }))
      await gateway.updatePokemon(patches)
      await repos.battles.update(id, { boardAppliedAt: deps.now() })
      ev?.set({ boardChanges: patches.length })
    }

    // 4. The update on both gyms' items, winner and loser (Eden, Task 16)
    let updateIds = doc.updateIds ?? []
    if (!doc.updatePostedAt) {
      updateIds = []
      for (const itemId of [doc.gymA.id, doc.gymB.id]) updateIds.push((await gateway.postUpdate(itemId, summary)).updateId)
      await repos.battles.update(id, { updatePostedAt: deps.now(), updateIds })
    }

    // 5. The card (Task 16, best effort): Object storage + attached to those updates
    const card = await battleCard(deps, doc, outcome, snapshot.pokemon, updateIds)

    // 6. Telegram battles: the result back to the chat (before 'done', so a failed send can be retried)
    await onBattleDone(deps, { ...doc, outcome, kos }, card)

    await repos.battles.update(id, { status: 'done', finishedAt: deps.now() })
    return 'done'
  } catch (err) {
    if (err instanceof QuotaError) {
      // Retrying can't help before the daily quota resets
      await repos.battles.update(id, { status: 'failed', error: 'QUOTA', finishedAt: deps.now() }).catch(() => {})
      ev?.error(err)
      // Best effort: the database is out of quota, so a retry can't record anything either
      await onBattleDone(deps, { ...doc, error: 'QUOTA' }).catch((e) => ev?.set({ resultNotSent: String(e) }))
      return 'failed'
    }
    await repos.battles.release(id).catch(() => {}) // let the queue's retry claim it at once
    throw err
  }
}
