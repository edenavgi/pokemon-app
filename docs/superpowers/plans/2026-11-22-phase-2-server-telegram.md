# Pokémon Gym Manager — Phase 2 (monday code server + Telegram bot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (**chosen by Eden on 2026-11-22: native, inline, slow**). Steps use checkbox (`- [ ]`) syntax for tracking.
> **Pace (Eden's requirement, this phase is for learning):** one step at a time in the main session. Before each step, say in Hebrew what it does and why. After it, show the result and wait for Eden's questions or go-ahead. No background subagents implement tasks.
> **Commit budget (Eden's rule, say it in every dispatch):** one commit per task. Review fixes are `git commit --fixup` and get autosquashed **before push**. They are never pushed as separate commits.
> **Learning track:** Claude writes the code, including the code that talks to monday. Every task ends with an **Explain** step: before moving on, Eden can say in their own words what each listed concept does and why.

**Goal:** Add a Node.js + TypeScript server on monday code and a Telegram bot. Any monday user can connect their account (OAuth 2.1 + PKCE), link a Telegram chat, and run the game (gyms, roster, train, rest, talk, battle) from Telegram. Battles become turn-by-turn server simulations that the app replays, and an hourly cron job regenerates Energy.

**Architecture:**
- An Express 5 server lives in `server/` with its own `package.json`. esbuild bundles it into `server/dist/index.js` and pulls in the pure rules from `src/game/` and the shared monday/PokéAPI code from `src/api/boards/` and `src/api/pokeapi/`. The app and the server run the **same** rule code.
- The platform services (Secure Storage, key-value Storage, Queue, Logger, Object storage) and Document DB sit behind small interfaces with in-memory fakes, so every route and handler can be unit-tested without monday.
- The app talks to the server with `Authorization: Bearer <sessionToken>`. Telegram reaches the server only through a webhook. Battles always go route → Queue → `/mndy-queue` → engine → Document DB → board.

**Stack decided by Eden (2026-11-22):** Express 5, official `mongodb` driver, `jsonwebtoken`, Telegram over plain `fetch`, `supertest`, Vitest, `mongodb-memory-server`, tsx + esbuild.

**Tech Stack:** Node 22, TypeScript, Express 5 (`express`, tests with `supertest`), `@mondaycom/apps-sdk@3.3.2`, `@mondaydotcomorg/api` (`ApiClient`, API version `2026-10`), `mongodb` driver, `jsonwebtoken` (JWT), esbuild, tsx, Vitest, `mongodb-memory-server` (tests), Telegram Bot API over `fetch` (no wrapper library). Bonus: `satori`, `@resvg/resvg-js`, `@fontsource/inter`.

**Spec:** `~/Desktop/Pokémon Gym Manager — Phase 2 monday code server + Telegram bot.pdf` (the "Phase 2 spec"). v1 still applies: `docs/superpowers/specs/2026-11-17-pokemon-gym-manager-design.md`. Platform facts were checked against `@mondaycom/apps-sdk@3.3.2`, `@mondaycom/apps-cli@4.11.2` and the monday docs on 2026-11-22. They are listed under **Platform facts** below.

## Global Constraints

- The server runs Node.js + TypeScript on **Express 5** (Eden's choice, 2026-11-22). The runtime is Node 22, set with `server/.mondaycoderc` `{"RUNTIME":"Node.js","RUNTIME_VERSION":"22.x.x"}`. The CLI allows 18/20/22.
- monday API version is **`2026-10`** everywhere, including `run_prompt`.
- Secrets and config are read through the SDK (`SecretsManager`, `EnvironmentVariablesManager`) in `server/src/config.ts` only. Nothing is hard-coded. Secrets: `MONDAY_CLIENT_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`. Env: `MONDAY_CLIENT_ID`, `SERVER_BASE_URL`, `TELEGRAM_BOT_USERNAME`.
- Data location, exactly as in the spec:
  - OAuth tokens → Secure Storage, key `monday-token:<userId>`
  - users / links / battles / battle_turns → Document DB
  - PokéAPI → key-value Storage with TTL
  - game state → boards
  - card PNGs → Object storage
- A monday OAuth token never reaches the front end, a log line or a wide event. `redact()` (Task 1) is applied to every emitted event.
- All logs go through the SDK `Logger`: **one wide event per unit of work** (one HTTP request, one queue message or one cron run). Every event has a `traceId`. A battle's events also carry `battleId`.
- Game rules come only from `src/game/` (`validateSpar`, `applySpar`, `applyRest`, `allowedTransitions`, `deriveStatus`, `evolutionCheck`, `buildTalkPrompt`, the new arena engine). The server never re-implements a rule.
- v1 constants are unchanged (`MAX_ENERGY = 3`, `READY_LEVEL = 5`, `MAX_ROSTER = 6`, …). New constants go in `src/game/constants.ts`.
- The board stays the source of truth. Board data is **never** cached on the server.
- Telegram replies to read/write/talk commands are sent **inline** from the webhook request. Only `/battle` goes through the queue.
- Webhook requests without the right `X-Telegram-Bot-Api-Secret-Token` get **401**, compared with `crypto.timingSafeEqual`.
- Git: follow `docs/GIT_WORKFLOW.md`. One branch per task (names are given per task). Never switch the branch of `~/Dev/pokemon-app`; use `git worktree add .superpowers/wt-<name> <branch>`.
- Verify before claiming done: the root `npx vitest run`, `npm run typecheck` and `npm run build`; for the server, `npm --prefix server run check` (typecheck + tests + bundle).

## Platform facts (verified 2026-11-22, these drive the design)

| Area | Fact | Consequence here |
|---|---|---|
| Deploy | `mapps code:push -d <dir> -a <appId> -i <versionId>`. It zips the dir using `.mappsignore` (else `.gitignore`) and always drops `node_modules`, `.env`, `.mappsrc` and `local-secure-storage.db.json`. Google buildpacks then run `npm run build` (or `gcp-build`) if present, and `npm start`. | `server/.mappsignore` does **not** ignore `dist/`. `server/package.json` has **no** `build` script, because the bundle is built before push (it imports `../src`, which the buildpack can't see). `start` is `node dist/index.js`. |
| Runtime | Cloud Run: 1 vCPU, 512 MiB, **300 s request timeout**, `PORT` injected (unconfirmed in monday docs). | Listen on `PORT ?? 8080`. A queue handler must finish well under 300 s, which `MAX_TURNS` guarantees. |
| SecureStorage | `new SecureStorage()`, `get/set/delete`. 7 req/s, 1 write/s per key. Locally it is a JSON file. | Token store with an in-process single-flight refresh. |
| Storage (KV) | `new Storage(accessToken)`. `get(key)` → `{success,value}`, `set(key,value,{ttl})` (ttl in seconds, ≤ 30 days), key ≤ 256 chars. No local mock: it always calls monday with the user's token. | The PokéAPI cache needs a user's OAuth token. Cache keys are short and versioned. |
| Queue | `new Queue().publishMessage(string)` → message id. Delivery is `POST /mndy-queue?secret=…`, checked with `validateMessageSecret(secret)`. Up to 10 attempts. Locally it POSTs to `${MNDY_SERVER_ADDRESS}/mndy-queue`. Production body shape is **unconfirmed**. | Idempotency key = our own `battleId` inside the payload. `parseQueueBody` accepts a raw JSON string **or** a `{message:{data:<base64>}}` envelope. |
| Logger | `new Logger(tag)`. `info/warn/debug(msg: string)`, `error(msg, {error})`. Strings only. | Wide events are emitted as `JSON.stringify(event)`. |
| Document DB | `MNDY_MONGODB_CONNECTION_STRING`, official `mongodb` driver. Limits per day: 50k reads, 20k writes, 20k deletes, 1 GiB, then `PERMISSION_DENIED`. Unique/TTL indexes are **unconfirmed**. No local emulator. | Locally: your own MongoDB. Single-use semantics come from `findOneAndDelete`, and expiry is checked in the query (no TTL index). Unique indexes are created and verified in Task 3 (fallback noted there). |
| Scheduler | `mapps scheduler:create -a -n -s "<cron UTC>" -e <path under /mndy-cronjob/> -r -t`. **POST** route. Runs only on the **live** version. Auth on the request is unconfirmed. | Route `POST /mndy-cronjob/energy-regen`. Task 14 logs header names on the first run and records them in verify-early. |
| OAuth 2.1 | Authorize: `https://auth.monday.com/oauth2/authorize?client_id&redirect_uri&state&code_challenge&code_challenge_method=S256`. Token: `POST https://auth.monday.com/oauth_ms/oauth/token` (`grant_type=authorization_code`, `client_id`, `client_secret`, `code`, `redirect_uri`, `code_verifier`). Response `{access_token, refresh_token, token_type, scope}`, **no `expires_in`**: read `exp` from the access-token JWT. Refresh tokens **rotate**. | The token store keeps `{accessToken, refreshToken, exp}` and refreshes when < 5 min are left. |
| sessionToken | JWT signed with the app's **client secret** (the forum reports "invalid signature" with the signing secret). Claims `exp`, `dat.user_id`, `dat.account_id`. | Verified with `MONDAY_CLIENT_SECRET`. Task 3 confirms the `alg` and claims on a real token and writes them to verify-early. |
| Object storage | `new ObjectStorage()` (needs `OBJECT_STORAGE_BUCKET`): `uploadFile(name, buf, {contentType})`, `downloadFile(name)` → `{content, contentType}`. No presigned download. | Card PNGs are read back through `GET /api/battles/:id/card`. |

## Design decisions (made by Claude, correct me)

1. **Board config on the server.** v1 keeps the board IDs in client SDK storage, which the server can't read. The app sends them with `PUT /api/me/boards` after OAuth and whenever they are saved. They live on the `users` document. The bot and the cron job read them from there.
2. **Battle rules (new engine, replaces v1 scoring):**
   - Fighters are `eligibleFighters(gym)` (Ready, Energy ≥ 1, roster order, max 6).
   - `maxHp = hp + 2 × level`.
   - In each matchup the faster Pokémon attacks first (a tie goes to side A), and the two alternate.
   - The attacker uses the move with the highest `power × effectiveness`. A tie goes to the earlier move.
   - `effectiveness` = the **product** over the defender's types of `chart[moveType][t] ?? 1`, so 0 / 0.25 / 0.5 / 1 / 2 / 4.
   - Damage, when `eff > 0`: `max(1, floor((((2×L/5 + 2) × power × atk/def) / 50 + 2) × eff × (0.85 + 0.15 × rng())))`, with `L = level`. Damage is `0` when `eff = 0`.
   - If every move a fighter has does 0 to the current defender, it uses **Struggle** (power 50, no type, eff 1). This way every matchup ends.
   - The winner keeps its remaining HP and meets the next opponent.
   - Safety cap: `MAX_TURNS = 300`. If it is hit, the side with more fighters left wins, then the side with more total HP %, otherwise it is a draw.
   - MVP is the fighter with the most KOs; a tie goes to the most damage dealt.
3. **Moves.** From `pokemon/{dex}.moves`, keep moves learned by `level-up` in any version group. Sort them by the lowest `level_learned_at`, then by name. Fetch `move/{name}` in that order, and keep the first 4 with `damage_class ≠ status`, `power > 0` and a known type. Look at no more than 12 candidates. With no move found, the fighter uses Struggle only.
4. **Energy after a battle (same rules as v1):** every Pokémon that fought loses 1 Energy. At 0 it is `Resting`, otherwise its status stays the same. This is the new `applyBattleFatigue` in `src/game/status.ts`. The post goes on the winning gym's item. On a draw, it goes on both items.
5. **Cron regen status.** The spec says "Resting at full Energy → Ready". In v1, though, Ready requires level ≥ 5 (`deriveStatus`). The plan uses `deriveStatus`: Ready at level ≥ 5, otherwise Training. If you want literal Ready, change one line in `applyRegen`.
6. **Idempotency (queue):**
   - The route creates the `battles` doc (`status: queued`, `seed`, `traceId`) **before** it publishes.
   - The handler claims the doc atomically. The pre-battle board state is saved once as `snapshot` and reused on a retry.
   - Turns use deterministic `_id = <battleId>:<n>` and are upserted.
   - Board writes are **absolute** values computed from the snapshot.
   - The update post and the Telegram reply each set a flag (`updatePostedAt`, `resultSentAt`) and are skipped if it is already set.
7. **Telegram retries.** Every `update_id` is inserted into `tg_updates` (`_id = update_id`) before handling. A duplicate is answered `200` and does nothing. The webhook always answers `200` after the secret check, so Telegram doesn't retry our own errors.
8. **Command arguments.** Names are matched case-insensitively. For gyms, the trailing " Gym" is optional. Quotes group words (`/battle "Cinnabar Gym" Cerulean`). Without quotes, `/battle` tries every split point and accepts exactly one split where both halves match a gym. An ambiguous Pokémon name gets a reply listing the matches with their item IDs, and an item ID is accepted as an argument.
9. **Link codes:** `randomBytes(32).toString('base64url')` (43 chars, alphabet `A-Za-z0-9_-`). Only `sha256(code)` is stored. The code expires after 10 min and is consumed with `findOneAndDelete`. Re-linking a user replaces the old chat. Linking a chat that was linked to another user replaces that link too.
10. **Local dev.** The server runs on `:8080` with `tsx watch` and `node --env-file=.env`. The Vite dev server proxies `/api`, `/oauth` and `/telegram` to it, so the one existing tunnel serves both. MongoDB runs locally (`docker run -p 27017:27017 mongo:8`). The Telegram webhook points at either the tunnel or the deployed URL, never both: re-run `npm --prefix server run webhook:set -- <baseUrl>` when switching.
11. **Replay reads.** Document DB reads are metered (50k a day). The Arena polls the battle **summary** (`?turns=0`) every 1.5 s and loads the turns once, when `status` is `done`.

## Review Focus

1. **The queue delivers the same battle twice, or the handler crashes halfway.** Expect one `battles` doc, one set of turns, Energy dropped once and one update post. Tested in Task 7 (`handles a redelivered message once`, `resumes after a crash between turns and board apply`).
2. **Two Pokémon that can't hurt each other** (Ghost-only moves vs Normal, Normal vs Ghost), or a Pokémon with no damaging moves. Expect the battle to end (Struggle) and never loop. Tested in Task 6 (`ends when both sides are immune`, `stops at MAX_TURNS`).
3. **Multi-word and ambiguous names** (`/battle Cinnabar Gym Cerulean Gym`, `/roster cinnabar`, two Charmanders). Expect the right match, or a reply that says what to type. Tested in Task 10 (`parseArgs`/`matchGym`/`matchPokemon`) and Task 15.
4. **A user's refresh token is revoked or rotated** while the cron job or a command runs. Expect that user to get "reconnect monday from the app" (bot) or to be logged as failed (cron) while everyone else continues. Tested in Task 4 (`refresh invalid_grant re-reads and retries once`) and Task 14 (`one user failing does not stop others`).
5. **Telegram retries an update we already applied** (`/train` sent twice with the same `update_id`). Expect the board changed once. Tested in Task 10 (`ignores a duplicate update_id`) and Task 11.

---

## File map

```
server/
  package.json  tsconfig.json  vitest.config.ts  esbuild.config.mjs
  .mappsignore  .mondaycoderc  .env.example
  scripts/set-webhook.ts
  src/
    index.ts                 # serve(app) on PORT
    app.ts                   # createApp(deps): Express — all routes mounted here
    deps.ts                  # Deps interface + createRealDeps() (SDK + Mongo) ; fakes in test/fakes.ts
    config.ts                # loadConfig(): Config  (SDK managers)
    log/wideEvent.ts         # WideEvent, withEvent(), redact()
    log/middleware.ts        # Express middleware: one event per request
    auth/sessionToken.ts     # verifySessionToken(), requireSession middleware
    auth/oauth.ts            # PKCE helpers + routes /api/oauth/start, /oauth/callback
    auth/tokenStore.ts       # TokenStore over SecureStorage (refresh, single-flight)
    db/mongo.ts              # connectDb(), ensureIndexes()
    db/repos.ts              # typed repos for every collection
    monday/client.ts         # mondayRequest(token) → GqlRequest (429 retry)
    pokeapi/cache.ts         # KvCache over Storage (hit/miss → event)
    battle/service.ts        # startBattle(), runBattleMessage(), applyBattleToBoard()
    battle/routes.ts         # /api/battles*, /mndy-queue
    telegram/api.ts          # TelegramApi (sendMessage, sendPhoto, setWebhook)
    telegram/webhook.ts      # POST /telegram/webhook
    telegram/commands.ts     # dispatch + one handler per command
    telegram/args.ts         # parseArgs, matchGym, matchPokemon
    telegram/texts.ts        # all bot copy
    telegram/linking.ts      # POST /api/telegram/link-code, /start handling
    cron/energyRegen.ts      # POST /mndy-cronjob/energy-regen
    card/renderCard.ts       # (bonus) satori + resvg
  test/fakes.ts              # in-memory SecureStorage/KV/Queue/Logger/ObjectStorage/Telegram/monday
src/
  game/arena.ts (+test)      # pure engine (Task 6)
  game/moves.ts (+test)      # pure move selection (Task 6)
  game/status.ts             # + applyBattleFatigue, applyRegen
  api/boards/                # shared GraphQL + mapping (Task 2)
  api/pokeapi/               # shared PokéAPI loaders (Task 2)
  api/server/serverClient.ts # app → server fetch with sessionToken (Task 5)
  features/gym-hq/ConnectTab.tsx, ArenaTab.tsx, BattleReplay.tsx
```

---

# Part 0 — Setup (🧑 Eden, by hand, before Task 1)

- [ ] **0.1 Bot:** in Telegram, `@BotFather` → `/newbot`. Keep the token in a password manager only, never in git or chat. Note the bot username.
- [ ] **0.2 Webhook secret:** generate one with `openssl rand -hex 32` (Telegram allows 1–256 chars `A-Za-z0-9_-`).
- [ ] **0.3 Developer Center → OAuth & Permissions:**
  - Add the redirect URLs `<tunnel URL>/oauth/callback` and `<server URL>/oauth/callback`. The server URL is known after Task 1's first push, so add it then.
  - Copy the Client ID. Keep the Client Secret in a password manager.
- [ ] **0.4 Local MongoDB:** `docker run -d --name pokemon-mongo -p 27017:27017 mongo:8`, or `brew install mongodb-community`.
- [ ] **0.5 `server/.env`** (gitignored, created after Task 1 adds `.env.example`): fill in every key from `.env.example`.
- **Done when:** you have the bot token, the webhook secret, the client ID/secret and a running local MongoDB.

---

### Task 1: Server skeleton on monday code (Feature 1)

**Branch:** `feat/server-skeleton`

**Files:**
- Create: everything under `server/` listed in the file map except `auth/`, `battle/`, `telegram/`, `cron/`, `card/` and `pokeapi/`.
- Modify: `vite.config.ts` (exclude `server/**` from root Vitest; dev proxy), `.gitignore` (`server/.env`, `server/local-secure-storage.db.json`), `.github/workflows/ci.yml` (server job), `.github/workflows/deploy.yml` (server push job), `CLAUDE.md` (server verify command), `README.md` (how to run the server).
- Test: `server/src/log/wideEvent.test.ts`, `server/src/app.test.ts`, `server/src/config.test.ts`

**Interfaces:**
- Produces:
  - `interface Config { mondayClientId: string; mondayClientSecret: string; serverBaseUrl: string; telegramBotToken: string; telegramWebhookSecret: string; telegramBotUsername: string; port: number }`
  - `loadConfig(src?: { env: (k: string) => string | undefined; secret: (k: string) => string | undefined }): Config`. It throws `Missing config: <KEY>` and names every missing key.
  - `class WideEvent { readonly traceId: string; set(fields: Record<string, unknown>): void; inc(key: string, by?: number): void; error(err: unknown): void; emit(logger: LoggerPort): void }`
  - `redact(value: unknown): unknown` replaces the value of any key matching `/token|secret|authorization|verifier|password|code$/i` with `"[redacted]"`, recursively.
  - `currentEvent(): WideEvent | undefined` (AsyncLocalStorage)
  - `withEvent<T>(kind: 'http' | 'queue' | 'cron', fields: Record<string, unknown>, fn: (ev: WideEvent) => Promise<T>, traceId?: string): Promise<T>`
  - `interface LoggerPort { info(msg: string): void; error(msg: string, opts?: { error?: Error }): void }`
  - `interface Deps { config: Config; logger: LoggerPort; now: () => Date }`, extended by later tasks.
  - `createApp(deps: Deps): Express` with `GET /health` → `200 {"ok":true,"version":<package version>}`.

- [ ] **Step 1: Scaffold `server/`.**
  - `package.json`:
    - `"type":"module"`, `"engines":{"node":"22.x"}`
    - scripts: `dev` (`tsx watch --env-file=.env src/index.ts`), `bundle` (`node esbuild.config.mjs`), `start` (`node dist/index.js`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `check` (`npm run typecheck && npm test && npm run bundle`). Task 9 adds `webhook:set`.
    - **no `build` script**
    - deps: `express@5`, `@mondaycom/apps-sdk@3.3.2`, `@mondaydotcomorg/api`, `mongodb`, `jsonwebtoken`; devDeps add `supertest`, `@types/express`, `@types/jsonwebtoken`, `@types/supertest`
    - devDeps: `typescript`, `tsx`, `esbuild`, `vitest`, `@types/node`, `mongodb-memory-server`
  - `tsconfig.json`: `module`/`moduleResolution` `nodenext`, `strict`, `paths: {"@app/*": ["../src/*"]}`, includes `src`, `test`, `scripts`, and `../src/game` + `../src/api/GameApi.ts` + `../src/lib/messages.ts`.
  - `esbuild.config.mjs`: entry `src/index.ts` → `dist/index.js`, `platform:'node'`, `target:'node22'`, `format:'esm'`, `bundle:true`, `packages:'external'` (npm deps stay external; `../src` is bundled), tsconfig paths honored.
  - `.mappsignore`: `node_modules`, `src`, `test`, `scripts`, `*.test.ts`, `.env`. **Not** `dist`.
  - `.mondaycoderc` as in Global Constraints.

- [ ] **Step 2: Write failing tests.**
  - `wideEvent.test.ts`:
    - `emits exactly one JSON line per unit of work`: two `set` calls → one `logger.info` call whose parsed JSON has `traceId`, `kind`, `durationMs` and both fields.
    - `redacts secrets at any depth`: `{a:{accessToken:'x', refresh_token:'y'}, headers:{authorization:'Bearer z'}}` → none of `x`, `y`, `z` appear in the output.
    - `error() records name and message and emits through logger.error`.
    - `currentEvent() is visible inside awaited calls and undefined outside`.
  - `app.test.ts`:
    - `GET /health returns ok`.
    - `every request emits one http event with method, path, status, durationMs`: use a fake logger and call `request(app).get('/health')` (supertest).
  - `config.test.ts`:
    - `reads secrets from secret() and env from env()`.
    - `names all missing keys`: the message contains `MONDAY_CLIENT_SECRET` and `TELEGRAM_BOT_TOKEN`.

- [ ] **Step 3: Run `npm --prefix server test`.** Expected: FAIL (modules missing).
- [ ] **Step 4: Implement** `config.ts`, `log/wideEvent.ts`, `log/middleware.ts`, `app.ts`, `deps.ts`, `index.ts`.
  - The real config source is `new SecretsManager().get(k)` / `new EnvironmentVariablesManager().get(k)`, falling back to `process.env[k]` **only when `process.env.K_SERVICE` is unset** (local).
  - The event fields for http are `kind:'http'`, `method`, `path` (route pattern, no query), `status`, `durationMs`, `traceId`. The traceId comes from `crypto.randomUUID()`.
- [ ] **Step 5: Run `npm --prefix server run check`.** Expected: PASS, and `server/dist/index.js` exists.
- [ ] **Step 6: Root config.**
  - `vite.config.ts`: add `test.exclude += ['server/**']` and `server.proxy = { '/api': 'http://localhost:8080', '/oauth': 'http://localhost:8080', '/telegram': 'http://localhost:8080' }`.
  - `ci.yml`: a new job `server` (`npm ci --prefix server`, `npm --prefix server run check`).
  - `deploy.yml`: a new job `deploy-server` (`needs: checks`) that runs `npm ci --prefix server`, `npm --prefix server run bundle` and `mapps code:push -d server -a "$APP_ID" -i "$APP_VERSION_ID"`.
  - In the client job, `npm run build` gets `VITE_SERVER_URL: ${{ vars.SERVER_URL }}`.
- [ ] **Step 7: Run the root checks** (`npx vitest run`, `npm run typecheck`, `npm run build`). Expected: PASS.
- [ ] **Step 8 (🧑 Eden + Claude): Deploy and prove logging.**
  1. Set config: `mapps code:env -i <appId> -m set -k MONDAY_CLIENT_ID -v …` (likewise `SERVER_BASE_URL`, `TELEGRAM_BOT_USERNAME`) and `mapps code:secret -i <appId> -m set -k …` for the three secrets.
  2. `npm --prefix server run bundle && mapps code:push -d server -a <appId> -i <versionId>`, then `mapps code:status -i <versionId>` → note the server URL.
  3. `curl <url>/health` → `{"ok":true,…}`.
  4. `mapps code:logs -i <versionId> -t console -s live` shows the http event. Also find it in Developer Center → monday code → Logs.
  5. Locally: `npm --prefix server run dev`, then `curl localhost:8080/health` and through the tunnel.
  6. Record in `docs/verify-early.md` §13:
     - Is `PORT` injected?
     - Do `SecretsManager`/`EnvironmentVariablesManager` read `process.env` locally?
     - Was `dist/` uploaded?
     - The server URL format, and that client and server pushes coexist on one version.
- [ ] **Step 9: Commit** `feat(server): express skeleton on monday code with wide-event logging`.
- [ ] **Explain:** the buildpack (why there is no `build` script), `.mappsignore`, env vs secret, wide event vs log lines, and `traceId`.

---

### Task 2: Shared board + PokéAPI modules (refactor, no behaviour change)

**Branch:** `refactor/shared-monday-modules`

The server must run the same GraphQL and mapping as the app. Move the transport-free code out of `src/api/monday/index.ts`.

**Files:**
- Create: `src/api/boards/queries.ts`, `src/api/boards/mapping.ts`, `src/api/boards/gateway.ts`, `src/api/boards/gateway.test.ts`, `src/api/pokeapi/loaders.ts`, `src/api/pokeapi/loaders.test.ts`
- Modify: `src/api/monday/index.ts` (now a thin adapter), `src/api/monday/flavorText.ts` (moved to `src/api/pokeapi/`, re-exported)

**Interfaces:**
- Produces:
  - `type GqlRequest = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>`. It resolves to the GraphQL **`data`** object; each adapter unwraps its own envelope.
  - `createBoardGateway(request: GqlRequest, cfg: BoardConfig)` returns:
    - `listGyms(): Promise<Gym[]>`
    - `getGym(id: Id): Promise<Gym>`
    - `listPokemon(opts?: { gymId?: Id; status?: Status }): Promise<Pokemon[]>`
    - `getPokemonMany(ids: Id[]): Promise<Pokemon[]>`
    - `updatePokemon(patches: { id: Id; patch: PokemonPatch }[]): Promise<void>`
    - `postUpdate(itemId: Id, body: string): Promise<{ updateId: Id }>`
    - `runPrompt(p: { system: string; user: string }): Promise<string>`
    - `me(): Promise<{ userId: Id; name: string; accountId: Id; accountName: string }>`
  - `type Fetch<T> = (url: string) => Promise<T>`
  - `interface PokeCache { get<T>(key: string): Promise<T | undefined>; set<T>(key: string, value: T, ttlSeconds: number): Promise<void> }`
  - `createPokeApi(fetchJson: <T>(url: string) => Promise<T>, cache: PokeCache)` returns:
    - `getSpecies(dex): Promise<SpeciesDetail>`
    - `getEvolution(dex): Promise<EvolutionInfo>`
    - `getTypeChart(): Promise<TypeChart>`
    - `listGen1(): Promise<SpeciesSummary[]>`
    - `getMoveset(dex): Promise<Move[]>` (new; algorithm in Design decision 3)
  - `interface Move { name: string; type: PokeType | null; power: number }`, added to `src/api/GameApi.ts`.

- [ ] **Step 1: Write failing tests.**
  - `gateway.test.ts` uses a fake `GqlRequest` that returns recorded shapes from `docs/verify-early.md` §2:
    - `maps a Pokemon item by column title`
    - `listGyms parses mirrored levels "5, 7"`
    - `updatePokemon resolves column ids by title then sends change_multiple_column_values once per item`
    - `postUpdate returns the update id`
    - `me() maps id/name/account`
  - `loaders.test.ts` uses a fake fetch and an in-memory `PokeCache`:
    - `getSpecies uses the cache on the second call`: the fetch count stays 2.
    - `getMoveset keeps the first 4 damaging level-up moves in learn order`: a fixture with a status move first and a 0-power move must be skipped.
    - `getMoveset stops after 12 candidates`
    - `getMoveset returns [] when no damaging move exists`
- [ ] **Step 2: Run `npx vitest run src/api`.** Expected: FAIL.
- [ ] **Step 3: Move the code.** Queries, `columnReader`, `toPokemon`, the gym mapping, `parseMirroredNumbers`, the patch → column-values mapping and `writeItems` move into `src/api/boards/*`. The PokéAPI loaders, type-chart/Gen-1 builders and name fixes move into `src/api/pokeapi/loaders.ts`. The client keeps its memory + SDK-storage caching by implementing `PokeCache` (ttl ignored), and `createMondayGameApi` calls `createBoardGateway(seamlessRequest, cfg)`. `seamlessRequest` unwraps `res.data.data`.
- [ ] **Step 4: Run all root checks.** Expected: PASS, and every existing screen test is unchanged.
- [ ] **Step 5 (🧑 Eden): Smoke test in monday through the tunnel.** Item view + Talk, Spar, Recruit (one each). A short "worked" is enough.
- [ ] **Step 6: Commit** `refactor(api): share board gateway and PokéAPI loaders with the server`.
- [ ] **Explain:** why one `GqlRequest` seam lets the iframe (Seamless) and the server (token) share every query.

---

### Task 3: Document DB + sessionToken auth (Feature 2, part 1)

**Branch:** `feat/server-auth-db`

**Files:**
- Create: `server/src/db/mongo.ts`, `server/src/db/repos.ts`, `server/src/db/repos.test.ts`, `server/src/auth/sessionToken.ts`, `server/src/auth/sessionToken.test.ts`, `server/test/fakes.ts`
- Modify: `server/src/app.ts` (CORS, `GET /api/me`, `PUT /api/me/boards`), `server/src/deps.ts`

**Interfaces:**
- Produces:
  - Collections and indexes (exact names):
    - `users`: `{ _id: userId, accountId, gymsBoardId?, pokemonBoardId?, createdAt, updatedAt }`
    - `links`: `{ _id: chatId(string), userId, accountId, linkedAt }`, unique index `userId_1`
    - `link_codes`: `{ _id: sha256hex, userId, accountId, expiresAt }`
    - `oauth_states`: `{ _id: state, userId, accountId, codeVerifier, expiresAt }`
    - `battles`: see Task 7; index `{ gymsBoardId: 1, createdAt: -1 }`
    - `battle_turns`: `{ _id: "<battleId>:<n>", battleId, n, … }`, index `{ battleId: 1, n: 1 }`
    - `tg_updates`: `{ _id: updateId(number), at }`
    - `regen_marks`: `{ _id: "<pokemonBoardId>:<YYYY-MM-DDTHH>" }`
  - `connectDb(uri: string): Promise<Db>` and `ensureIndexes(db: Db): Promise<void>`.
  - `createRepos(db: Db): Repos`. Methods are added by the tasks that use them. This task adds:
    - `users.upsert(u: { userId; accountId }): Promise<void>`
    - `users.get(userId): Promise<UserDoc | null>`
    - `users.setBoards(userId, cfg: BoardConfig): Promise<boolean>` (false when no user doc)
    - `links.getByUser(userId)`
  - `interface Session { userId: Id; accountId: Id }`
  - `verifySessionToken(token: string, clientSecret: string): Promise<Session>` (jsonwebtoken `jwt.verify` with `algorithms: ['HS256']`). It throws `AuthError`.
  - Middleware `requireSession(deps)`. It sets `res.locals.session` and adds `userId`/`accountId` to the event.
  - Routes:
    - `GET /api/me` → `{ connected: boolean, boardsKnown: boolean, telegram: { linked: boolean } }`
    - `PUT /api/me/boards` → 204, or 409 `{error:'NOT_CONNECTED'}`
  - Test fakes in `server/test/fakes.ts`: `fakeLogger()`, `fakeSecureStorage()`, `fakeKv()`, `fakeQueue()`, `fakeTelegram()`, `fakeMonday()` (a `GqlRequest` over in-memory boards seeded from `src/api/mock/fixtures.ts`), `testDb()` (mongodb-memory-server).

- [ ] **Step 1: Write failing tests.**
  - `sessionToken.test.ts` signs tokens with `jwt.sign` in the test:
    - `accepts a valid token and returns user and account`
    - `rejects a wrong secret`
    - `rejects an expired token`
    - `rejects a token without dat.user_id`
  - `app.test.ts`:
    - `GET /api/me without Authorization → 401 and no handler runs`
    - `with a bad token → 401`
    - `with a valid token and no user doc → connected:false`
    - `PUT /api/me/boards before OAuth → 409`
    - `CORS allows https://*.monday.app and rejects https://evil.test`
  - `repos.test.ts` (memory server):
    - `ensureIndexes is idempotent`
    - `links unique userId rejects a second chat for the same user`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** CORS origin check: `/^https:\/\/([a-z0-9-]+\.)*monday\.(com|app)$/`, plus `http://localhost:5173` and `SERVER_BASE_URL`. Map Mongo `PERMISSION_DENIED` (code 13) to a `QuotaError` that later handlers turn into a friendly reply.
- [ ] **Step 4: Run `npm --prefix server run check`.** Expected: PASS.
- [ ] **Step 5 (verify early): check the real platform.**
  - In the app console, `monday.get('sessionToken')`. Decode the header and payload only (never paste the token anywhere) and record `alg` and the `dat` keys.
  - On the deployed server, run `ensureIndexes` once and check that a duplicate `links.userId` insert fails.
  - Write the results in verify-early §14. **If unique indexes are not supported:** `links` becomes `_id = userId` with a `chatId` field and a lookup by chatId. Note that change in this task's commit body.
- [ ] **Step 6: Commit** `feat(server): document db repos and sessionToken auth`.
- [ ] **Explain:** what the sessionToken proves (who is calling, from which account, signed by monday) and what it doesn't (it is not an API token). Also explain why each collection exists.

---

### Task 4: OAuth 2.1 + PKCE and the token store (Feature 2, part 2)

**Branch:** `feat/server-oauth`

**Files:**
- Create: `server/src/auth/oauth.ts`, `server/src/auth/oauth.test.ts`, `server/src/auth/tokenStore.ts`, `server/src/auth/tokenStore.test.ts`, `server/src/monday/client.ts`, `server/src/monday/client.test.ts`
- Modify: `server/src/app.ts`, `server/src/db/repos.ts` (`oauthStates.create/consume`)

**Interfaces:**
- Consumes: `requireSession`, `Repos`, `createBoardGateway`, `GqlRequest` (Tasks 2–3).
- Produces:
  - `pkcePair(): { verifier: string; challenge: string }`: verifier = 32 random bytes base64url, challenge = base64url(sha256(verifier)).
  - `POST /api/oauth/start` (session) → `{ authorizeUrl }`. It stores `oauth_states { state (24 random bytes base64url), userId, accountId, codeVerifier, expiresAt: now+10min }`.
  - `GET /oauth/callback?code&state`:
    1. consume the state (`findOneAndDelete` with `expiresAt > now`)
    2. exchange the code
    3. `me()` with the new token **must equal** the state's userId/accountId, otherwise 403 and nothing is stored
    4. `tokens.save`
    5. `users.upsert`
    6. an HTML page: "Connected — you can close this tab."
  - `interface StoredToken { accessToken: string; refreshToken: string; exp: number }` (`exp` is read from the access-token JWT payload with `decodeJwt`).
  - `class TokenStore`:
    - `constructor(secure: SecureStoragePort, oauth: OAuthPort, now: () => Date)`
    - `save(userId, t: StoredToken)`
    - `has(userId): Promise<boolean>`
    - `getAccessToken(userId): Promise<string>`: refresh when `exp - now < 300 s`; single-flight per user. On `invalid_grant` it re-reads Secure Storage once (another instance may have rotated the token) and retries; otherwise it throws `ReconnectNeededError`.
    - `delete(userId)`
  - `interface OAuthPort { exchangeCode(code, verifier): Promise<StoredToken>; refresh(refreshToken): Promise<StoredToken> }`, real version over `fetch`. The URLs are in Platform facts.
  - `mondayRequestFor(tokenStore, userId): GqlRequest`, built on `new ApiClient({ token, apiVersion: '2026-10' })`. On HTTP 429 or `COMPLEXITY_BUDGET_EXHAUSTED` it waits `retry_in_seconds` (max 10 s) once, then throws `RateLimitedError`. It adds `mondayCalls` to the current event.

- [ ] **Step 1: Write failing tests.**
  - `oauth.test.ts`:
    - `start returns an authorize URL with client_id, redirect_uri, state, code_challenge, code_challenge_method=S256`
    - `challenge is base64url sha256 of the verifier`, checked with the RFC 7636 appendix B vector: verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` → challenge `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`
    - `callback with unknown or expired state → 400, nothing stored`
    - `callback twice with the same state → second is 400`
    - `callback where me() is a different user → 403, nothing stored`
    - `callback stores the token and upserts the users doc`
    - `no event emitted by these routes contains the access or refresh token`
  - `tokenStore.test.ts`:
    - `returns the stored token when exp is far`
    - `refreshes when < 5 min left and saves the rotated pair`
    - `two concurrent calls refresh once`
    - `refresh invalid_grant re-reads and retries once`
    - `second invalid_grant → ReconnectNeededError`
  - `client.test.ts`:
    - `retries once after retry_in_seconds on 429`
    - `throws RateLimitedError on a second 429`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the files above. The redirect URI is `${SERVER_BASE_URL}/oauth/callback`. Secure Storage key: `monday-token:<userId>`.
- [ ] **Step 4: Run `npm --prefix server run check`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): oauth 2.1 with pkce and refreshable token store`.
- [ ] **Explain:**
  - What PKCE protects against (a stolen authorization code is useless without the verifier).
  - Why `state` is single-use and bound to the user.
  - Why the callback re-checks `me()`.
  - Why refresh tokens rotate.

---

### Task 5: App side — connect status, OAuth start, board sync (Feature 2, done)

**Branch:** `feat/app-server-connect`

**Files:**
- Create: `src/api/server/serverClient.ts`, `src/api/server/serverClient.test.ts`, `src/features/gym-hq/ConnectTab.tsx`, `src/features/gym-hq/ConnectTab.test.tsx`
- Modify: `src/api/GameApi.ts`, `src/api/mock/MockGameApi.ts`, `src/api/monday/index.ts`, `src/features/gym-hq/GymHQ.tsx` (4th tab "Connect"), `src/lib/messages.ts` (`connectText`), `.env.example` (`VITE_SERVER_URL=`)

**Interfaces:**
- Produces (added to `GameApi`):
  - `interface ServerStatus { connected: boolean; boardsKnown: boolean; telegramLinked: boolean }`
  - `getServerStatus(): Promise<ServerStatus>`
  - `startMondayOAuth(): Promise<void>`: POST `/api/oauth/start`, then `monday.execute('openLinkInTab', { url })`
  - `syncBoardConfig(cfg: BoardConfig): Promise<void>`: PUT `/api/me/boards`
  - `createServerClient(baseUrl: string, getSessionToken: () => Promise<string>)` → `{ get<T>(path), post<T>(path, body?), put(path, body) }`. It throws `ServerError { status, code }`.
- `setBoardConfig` in `MondayGameApi` also calls `syncBoardConfig` (best effort, a warning on failure).

- [ ] **Step 1: Write failing tests.**
  - `serverClient.test.ts`:
    - `sends Authorization: Bearer <sessionToken> on every call`
    - `maps a 401 to ServerError{status:401}`
  - `ConnectTab.test.tsx` (MockGameApi with toggles):
    - `not connected → shows Connect to monday, Connect Telegram is disabled`
    - `click Connect → startMondayOAuth called, then polls status every 2 s until connected (max 2 min)`
    - `connected and boards unknown → calls syncBoardConfig once with the saved config`
    - `connected → Connect Telegram enabled` (its action comes in Task 9)
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The session token comes from `monday.get('sessionToken')`. `baseUrl` is `import.meta.env.VITE_SERVER_URL ?? ''` (an empty string means same origin through the Vite proxy).
- [ ] **Step 4: Run the root checks.** Expected: PASS.
- [ ] **Step 5 (🧑 Eden): end to end in monday through the tunnel.**
  1. Open Gym HQ → Connect → OAuth tab → approve.
  2. The tab says "Connected" and Gym HQ shows connected.
  3. `local-secure-storage.db.json` has `monday-token:<id>`.
  4. Mongo `users` has the doc with board IDs.
  5. The server log line has no token.
- [ ] **Step 6: Commit** `feat(app): connect the app to the server with oauth and board sync`.
- [ ] **Explain:** the full sequence (sessionToken → start → monday consent → callback → Secure Storage) and why the app never sees the token.

---

### Task 6: Arena battle engine (pure)

**Branch:** `feat/arena-engine`

**Files:**
- Create: `src/game/arena.ts`, `src/game/arena.test.ts`
- Modify: `src/game/constants.ts`, `src/game/status.ts` + `status.test.ts`, `src/api/mock/fixtures.ts` (movesets)

**Interfaces:**
- Consumes: `eligibleFighters` (moved here from `battle.ts`), `Rng`, `mulberry32`, `TypeChart`, `Move`.
- Produces:
  - Constants: `MAX_TURNS = 300`, `DAMAGE_RANDOM_MIN = 0.85`, `DAMAGE_RANDOM_MAX = 1.0`, `STRUGGLE: Move = { name: 'Struggle', type: null, power: 50 }`, `HP_PER_LEVEL = 2`.
  - `interface ArenaFighter { id: Id; name: string; types: PokeType[]; level: number; hp: number; attack: number; defense: number; speed: number; moves: Move[] }`
  - `interface ArenaTeam { id: Id; name: string; fighters: ArenaFighter[] }`
  - `interface ArenaTurn { n: number; matchup: number; side: 'A' | 'B'; attackerId: Id; attackerName: string; defenderId: Id; defenderName: string; move: string; moveType: PokeType | null; effectiveness: number; damage: number; defenderHpLeft: number; defenderMaxHp: number; fainted: boolean }`
  - `interface ArenaOutcome { winner: 'A' | 'B' | 'draw'; endedBy: 'knockout' | 'turnLimit'; turnCount: number; fought: Id[]; mvp: { id: Id; name: string; kos: number; damage: number } | null; survivorsA: number; survivorsB: number }`
  - `function* simulateArena(a: ArenaTeam, b: ArenaTeam, chart: TypeChart, rng: Rng): Generator<ArenaTurn, ArenaOutcome>`
  - `validateArena(gymA: Gym, gymB: Gym): { ok: true } | { ok: false; error: 'SAME_GYM' | 'A_NOT_ELIGIBLE' | 'B_NOT_ELIGIBLE' }`, using the v1 error codes and texts (`battleErrorText`).
  - `toArenaTeam(gym: Gym, movesets: Map<number, Move[]>): ArenaTeam`
  - `moveEffectiveness(moveType: PokeType | null, defender: PokeType[], chart: TypeChart): number`
  - `damage(att: ArenaFighter, def: ArenaFighter, move: Move, eff: number, r: number): number`, formula as in Design decision 2.
  - `applyBattleFatigue(p: Pokemon): PokemonPatch` → `{ energy: max(0, e-1), status: e-1 <= 0 ? 'Resting' : p.status }`
  - `applyRegen(p: Pokemon): PokemonPatch | null`: null at `MAX_ENERGY`; otherwise `energy+1`, and if `p.status === 'Resting'` and the new energy is `MAX_ENERGY`, `status: deriveStatus(...)`.

- [ ] **Step 1: Write failing tests** (`arena.test.ts`, `status.test.ts`):
  - `damage matches the formula`: Charmander L5 (atk 52), Ember (power 40, Fire), vs Bulbasaur (def 49), eff 2 → `9` at `r = 0` and `10` at `r = 0.999`
  - `damage is 0 when eff is 0 and at least 1 otherwise`
  - `moveEffectiveness multiplies over dual types (Ice vs Grass/Flying = 4)` and `null type is 1`
  - `faster fighter attacks first; tie goes to A`
  - `winner stays in with remaining HP and meets the next opponent`
  - `battle ends when one team has no fighters; winner is the other`
  - `ends when both sides are immune`: a Ghost fighter with only Ghost moves vs a Normal fighter with only Normal moves → both use Struggle, the battle ends with a knockout, and no turn is a 0-damage loop
  - `stops at MAX_TURNS and decides by survivors then HP%`: two fighters with huge HP and 1-power moves
  - `yields turns with consecutive n starting at 1 and defenderHpLeft never below 0`
  - `is deterministic for a seed`: two runs with `mulberry32(7)` yield equal turn arrays
  - `fought lists every fighter that appeared, mvp = most KOs then damage`
  - `toArenaTeam uses eligibleFighters order and Struggle-only when the moveset is empty`
  - `applyBattleFatigue 1 → 0 Resting; 3 → 2 keeps Ready`
  - `applyRegen: 3 → null; Resting 2 → 3 Ready at level 5, Training at level 3; Training 1 → 2 stays Training; Resting 0 → 1 stays Resting`
- [ ] **Step 2: Run `npx vitest run src/game`.** Expected: FAIL.
- [ ] **Step 3: Implement** to the signatures. The move choice is the argmax of `power × eff`, with Struggle when the max is 0.
- [ ] **Step 4: Run the root checks.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(game): turn-by-turn arena engine with winner-stays-on`.
- [ ] **Explain:** why the engine is a generator (the caller persists turns while the battle runs), and why a seed makes a retry produce the same battle.

---

### Task 7: Arena on the server — queue, Document DB, board apply (Feature 3)

**Branch:** `feat/server-arena`

**Files:**
- Create: `server/src/battle/service.ts`, `server/src/battle/service.test.ts`, `server/src/battle/routes.ts`, `server/src/battle/routes.test.ts`
- Modify: `server/src/db/repos.ts`, `server/src/app.ts`, `server/src/deps.ts` (`queue`, `pokeApiFor(userId)` with a pass-through cache for now)

**Interfaces:**
- Consumes: `simulateArena`, `validateArena`, `toArenaTeam`, `applyBattleFatigue`, `createBoardGateway`, `mondayRequestFor`, `TokenStore`, `Repos`.
- Produces:
  - `BattleDoc { _id: battleId; traceId; source: 'app' | 'telegram'; chatId?: string; userId; accountId; gymsBoardId; gymA: {id,name}; gymB: {id,name}; seed: number; status: 'queued' | 'running' | 'done' | 'failed'; claimedAt?; snapshot?: { pokemon: { id, energy, status }[]; teams: { a: ArenaTeam; b: ArenaTeam } }; outcome?: ArenaOutcome; summary?: string; boardAppliedAt?; updatePostedAt?; resultSentAt?; error?: string; createdAt; finishedAt? }`
  - `interface BattleMessage { v: 1; battleId: string; traceId: string }`
  - `parseQueueBody(raw: string): BattleMessage`: accepts a raw JSON string or `{message:{data:base64}}`. It throws on anything else.
  - `startBattle(deps, s: { userId; accountId; source; chatId?; gymAId; gymBId; traceId }): Promise<{ battleId } | { error: 'SAME_GYM' | 'A_NOT_ELIGIBLE' | 'B_NOT_ELIGIBLE' | 'NOT_CONNECTED' | 'NO_BOARDS' | 'UNKNOWN_GYM' }>`. It validates against live gyms, inserts `battles` (`queued`) and **then** publishes.
  - `runBattleMessage(deps, msg: BattleMessage): Promise<'done' | 'skipped'>`:
    1. Claim with `findOneAndUpdate({_id, $or:[{status:'queued'}, {status:'running', claimedAt < now-5min}]}, {status:'running', claimedAt})`. With no claim → `skipped`. A `done` doc → `skipped`.
    2. Read the gyms, save `snapshot` if absent, then load movesets (`pokeApi.getMoveset`).
    3. Iterate the generator. Every 10 turns, and at the end, `bulkWrite` upserts on `battle_turns`.
    4. Save the outcome and the summary.
    5. If `boardAppliedAt` is unset: `updatePokemon` with absolute values from the snapshot (`applyBattleFatigue` on the snapshot energy/status), then set `boardAppliedAt`.
    6. If `updatePostedAt` is unset: `postUpdate` on the winner's item (both on a draw), then set it.
    7. Set `status:'done'`. Telegram-specific steps are added in Task 15 through a `onBattleDone` hook (no-op for now).
  - `battleSummaryText(doc: BattleDoc): string`. The first line is `"<A> vs <B> — <winner> wins (<turns> turns, MVP <name>)"` or `"… — draw …"`; then one line per KO.
  - Routes:
    - `POST /api/battles` (session) `{ gymAId, gymBId }` → `202 { battleId }`, or `400 { error }` with v1's `battleErrorText`
    - `GET /api/battles/:id?turns=0|1` (session, same `accountId` only, else 404) → `{ battle: BattleView, turns?: ArenaTurn[] }`
    - `GET /api/battles?limit=10` → recent battles for the user's `gymsBoardId`
    - `POST /mndy-queue?secret=` → 401 without `validateMessageSecret`. Otherwise it runs `runBattleMessage` inside `withEvent('queue', {battleId}, …, msg.traceId)` and returns 200. It also returns 200 for `skipped`, and for poison messages (unparseable or unknown battleId) after logging them.
  - `BattleView` = BattleDoc without `snapshot`, `seed` or `userId`.

- [ ] **Step 1: Write failing tests** (fakes + memory Mongo; fixture boards from `fakeMonday()`):
  - `POST /api/battles publishes one message after inserting the battle and returns 202`
  - `POST /api/battles with no eligible fighters → 400 A_NOT_ELIGIBLE and nothing published`
  - `queue route rejects a wrong secret with 401`
  - `runBattleMessage writes every turn and the replay GET returns them in order, equal to a direct simulateArena run with the same seed and teams`
  - `applies energy -1 to every fighter that fought and Resting at 0; posts one update on the winner`
  - `handles a redelivered message once`: run it twice → `updatePokemon` called once, `postUpdate` once, and the turn count unchanged
  - `resumes after a crash between turns and board apply`: make `updatePokemon` throw once → the first run throws (the queue would retry), the second run applies the board once and reuses the snapshot (energy is not lowered twice)
  - `GET /api/battles/:id from another account → 404`
  - `queue and http events of one battle share the traceId and battleId`: collect fake logger lines
  - `parseQueueBody accepts raw JSON and a base64 envelope`
  - `a QuotaError from Mongo fails the battle with status failed and error QUOTA`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** to the interfaces.
- [ ] **Step 4: Run `npm --prefix server run check`.** Expected: PASS.
- [ ] **Step 5 (verify early, deployed):**
  - Fire one battle with `curl` (sessionToken from the app console).
  - Record the real `/mndy-queue` body shape and headers in verify-early §15.
  - Find all events with `mapps code:logs -i <versionId> -t console -r <traceId>`.
- [ ] **Step 6: Commit** `feat(server): arena battles through the queue with idempotent board changes`.
- [ ] **Explain:** at-least-once delivery, the claim + snapshot + flags pattern, and why the route returns at once.

---

### Task 8: Arena replay in the app

**Branch:** `feat/arena-replay`

**Files:**
- Create: `src/features/gym-hq/BattleReplay.tsx`, `src/features/gym-hq/BattleReplay.test.tsx`
- Modify: `src/api/GameApi.ts`, `src/api/mock/MockGameApi.ts`, `src/api/monday/index.ts`, `src/features/gym-hq/ArenaTab.tsx` + test, `src/lib/messages.ts`
- Delete: `src/game/battle.ts`, `src/game/battle.test.ts` (v1 scoring; `eligibleFighters` lives in `arena.ts` since Task 6)

**Interfaces:**
- Produces (on `GameApi`):
  - `startBattle(gymAId: Id, gymBId: Id): Promise<{ battleId: Id }>`
  - `getBattle(battleId: Id, opts: { turns: boolean }): Promise<{ battle: BattleView; turns?: ArenaTurn[] }>`
  - `listBattles(limit?: number): Promise<BattleView[]>`
  - `BattleView` and `ArenaTurn` are exported from `GameApi.ts`. The mock runs `simulateArena` in memory with fixture movesets.
- `<BattleReplay battle turns stepMs={600} />`: two HP bars for the current matchup, a turn log line per step, Skip → final, and a result headline with the MVP.

- [ ] **Step 1: Write failing tests:**
  - `ArenaTab: Battle → startBattle, shows "Battle queued…", polls getBattle({turns:false}) every 1.5 s, then loads turns once`
  - `ArenaTab: shows battleErrorText for a 400`
  - `ArenaTab: lists recent battles and replays one, including a Telegram one`
  - `ArenaTab: stops polling after 120 s with a retry message`
  - `ArenaTab no longer calls updatePokemon or postUpdate` (the server does the board)
  - `BattleReplay: steps through every turn in order and its final HP equals the last turn's defenderHpLeft`
  - `BattleReplay: Skip jumps to the result`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use fake timers in the tests.
- [ ] **Step 4: Run the root checks.** Expected: PASS.
- [ ] **Step 5 (🧑 Eden):** in monday, run a battle in Gym HQ → the replay plays. The board shows Energy −1 on the fighters and an update on the winner. `mapps code:logs -r <traceId>` shows the http and queue events.
- [ ] **Step 6: Commit** `feat(app): server-side arena with turn-by-turn replay`.
- [ ] **Explain:** why the front end no longer writes to the board after a battle.

---

### Task 9: Link Telegram (Feature 4)

**Branch:** `feat/telegram-link`

**Files:**
- Create: `server/src/telegram/api.ts` + test, `server/src/telegram/webhook.ts` + test, `server/src/telegram/linking.ts` + test, `server/src/telegram/texts.ts`, `server/scripts/set-webhook.ts`
- Modify: `server/src/app.ts`, `server/src/db/repos.ts` (`linkCodes`, `links`, `tgUpdates`), `src/api/GameApi.ts` + mock + monday (`createTelegramLink(): Promise<{ url: string }>`), `src/features/gym-hq/ConnectTab.tsx` + test

**Interfaces:**
- Produces:
  - `interface TelegramPort { sendMessage(chatId: string, text: string): Promise<void>; sendPhoto(chatId: string, png: Buffer, caption: string): Promise<void>; setWebhook(url: string, secret: string): Promise<void> }`
  - The real one is `createTelegramApi(token, fetch)`. `sendMessage` splits text over 4096 chars; captions are cut at 1024. On 429 it retries once if `retry_after ≤ 5`, else throws `RateLimitedError`. Every call adds `telegramCalls` to the event. The bot token never appears in an event, because URLs are redacted.
  - `newLinkCode(): string` (43 chars) and `hashCode(code): string` (sha256 hex).
  - `POST /api/telegram/link-code` (session; 409 `NOT_CONNECTED` without a stored token) → `{ url: "https://t.me/<TELEGRAM_BOT_USERNAME>?start=<code>" }`. It deletes the user's old codes and expired codes first.
  - `POST /telegram/webhook`:
    1. Secret header check → 401 otherwise.
    2. `tgUpdates.markNew(update_id)`. A duplicate → 200.
    3. `handleUpdate` inside `withEvent('http', {updateId, chatId, command})`.
    4. Always 200.
  - `handleStart(deps, chatId, code)`: consume the code → `links.replaceForUser({chatId, userId, accountId})`. `me()` with the user's token → reply `texts.linked(name, accountName, userId, accountId)`. An invalid or expired code → `texts.badCode`.
  - `resolveChat(deps, chatId): Promise<{ ok: true; userId; accountId; gateway: BoardGateway; pokeApi } | { ok: false; reply: string }>`. The replies are `texts.notLinked` ("Link your account from the app first: open Gym HQ → Connect → Connect Telegram."), `texts.noBoards` and `texts.reconnect`.
  - `scripts/set-webhook.ts <baseUrl>` (npm script `webhook:set`: `tsx --env-file=.env scripts/set-webhook.ts`) → `setWebhook(`${baseUrl}/telegram/webhook`, TELEGRAM_WEBHOOK_SECRET)` with `allowed_updates:['message']`.

- [ ] **Step 1: Write failing tests:**
  - `newLinkCode is 43 chars of [A-Za-z0-9_-] and differs each call`
  - `link-code requires a session and a stored token`
  - `webhook without or with a wrong secret header → 401 and no handler`
  - `/start with a valid code links the chat, replies with user and account, and the code is gone`
  - `the same code twice → second gets badCode`
  - `a code older than 10 minutes → badCode` (fake clock)
  - `the link belongs to the user who asked for the code`
  - `relinking a user to a new chat removes the old link`
  - `any command from an unlinked chat → notLinked reply`
  - `ignores a duplicate update_id`
  - `sendMessage retries once on 429 with retry_after 1`
  - `ConnectTab: Connect Telegram opens the returned t.me URL in a new tab`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run both checks.** Expected: PASS.
- [ ] **Step 5 (🧑 Eden):**
  1. `npm --prefix server run webhook:set -- <tunnel URL>`.
  2. In the app: Connect Telegram → Telegram opens → Start → the bot names your monday user and account.
  3. Send `/gyms` from a second, unlinked Telegram account → the friendly reply.
- [ ] **Step 6: Commit** `feat(telegram): webhook with secret token and one-time account linking`.
- [ ] **Explain:** for each property of the code, what would go wrong without it:
  - random: guessable
  - long: brute-forceable
  - expiring: an old link in chat history keeps working
  - single-use: a forwarded link links someone else
  - tied to a user: the code can't be replayed for another account

---

### Task 10: Command router + `/gyms`, `/roster <gym>` (Feature 5)

**Branch:** `feat/telegram-read-commands`

**Files:**
- Create: `server/src/telegram/args.ts` + test, `server/src/telegram/commands.ts` + test
- Modify: `server/src/telegram/webhook.ts`, `server/src/telegram/texts.ts`

**Interfaces:**
- Produces:
  - `parseCommand(text: string, botUsername: string): { name: string; args: string[] } | null`. It strips `@botname` and keeps quoted args as one token.
  - `matchGym(query: string, gyms: Gym[]): { ok: true; gym: Gym } | { ok: false; reply: string }`. Case-insensitive; the trailing " gym" is optional; exact match first, then a unique prefix. Errors: `texts.unknownGym(query, names)` or `texts.ambiguousGym`.
  - `splitTwoGyms(args: string[], gyms: Gym[]): { ok: true; a: Gym; b: Gym } | { ok: false; reply: string }` (Design decision 8)
  - `matchPokemon(query: string, pokemon: Pokemon[]): { ok: true; p: Pokemon } | { ok: false; reply: string }`. An all-digit query is an item ID. Ambiguous → `texts.ambiguousPokemon(matches)` listing `name (gym, Lv n, id …)`.
  - `type CommandHandler = (ctx: CommandCtx, args: string[]) => Promise<string>`, where `CommandCtx = { chatId; userId; accountId; gateway; pokeApi; deps }`
  - `COMMANDS: Record<string, CommandHandler>` starts with `gyms`, `roster`, `help`. An unknown command → `texts.help`.
  - Formats:
    - `/gyms` lines: `"<name> — <Type or 'no type'> — <n> Pokémon"`
    - `/roster` lines: `"<name> — Lv <level> — <status> — ⚡<energy>/<MAX_ENERGY>"`
  - Missing argument → `texts.usage('/roster <gym>')`.

- [ ] **Step 1: Write failing tests:**
  - `parseArgs`: `/roster@MyBot Cinnabar Gym` → name `roster`, args `['Cinnabar','Gym']`; `/battle "Cinnabar Gym" Cerulean` → 2 args
  - `matchGym`: `cinnabar` → Cinnabar Gym; `cinnabar gym` → Cinnabar Gym; `Ci` with gyms `Cinnabar` and `Citrine` → ambiguous; `Nope` → unknown and lists the names
  - `splitTwoGyms`: `['Cinnabar','Gym','Cerulean','Gym']` → the right pair; `['A','B','C']` where both `A B|C` and `A|B C` match → ambiguous reply asking for quotes
  - `matchPokemon` by name, by ID, and the ambiguous case
  - `/gyms lists every gym with type and count`
  - `/roster Cinnabar lists level, status and energy`
  - `/roster without args → usage`
  - `reads live: the gateway is called on each command` (no caching of board data)
  - `the reply is sent inline from the webhook request; nothing is published to the queue`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm --prefix server run check`.** Expected: PASS.
- [ ] **Step 5 (🧑 Eden):** `/gyms`, `/roster cinnabar`, `/roster nope` in Telegram.
- [ ] **Step 6: Commit** `feat(telegram): /gyms and /roster read live from the boards`.
- [ ] **Explain:** why board data is read live and never cached.

---

### Task 11: `/train <pokemon> <partner>` and `/rest <pokemon>` (Feature 6)

**Branch:** `feat/telegram-write-commands`

**Files:**
- Modify: `server/src/telegram/commands.ts` + test, `server/src/telegram/texts.ts`

**Interfaces:**
- Consumes: `validateSpar`, `applySpar`, `allowedTransitions`, `applyRest`, `evolutionCheck`, `sparErrorText`, `evoBlockText`, `pokeApi.getEvolution`, `gateway.updatePokemon`.
- Produces: the handlers `train` and `rest`.
  - **train:** `matchPokemon` both names (two args; if a name has spaces, quote it) → `getPokemonMany` fresh → `validateSpar` → `updatePokemon` both with `applySpar` in **one** call. The reply has the new level, energy and status for each. For each one where `evolutionCheck(after, evo).eligible`, it adds `texts.canEvolve(name, target)`.
  - **rest:** match → fresh → `allowedTransitions(p).canRest`, otherwise `texts.cantRest(name, status)` → `applyRest`.

- [ ] **Step 1: Write failing tests:**
  - `/train two Pokémon in the same gym → both level +1, energy −1, deriveStatus`
  - `/train across gyms → sparErrorText(DIFFERENT_GYMS) and no write`
  - `/train with a Resting or 0-energy partner → the v1 text and no write`
  - `/train that reaches level 3 at stage 1 → mentions it can evolve`
  - `/rest on Resting → energy 3, status by level`
  - `/rest on Ready → cantRest and no write`
  - `/train with one arg → usage`
  - `a duplicate update_id for /train applies once` (webhook level)
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm --prefix server run check`.** Expected: PASS.
- [ ] **Step 5 (🧑 Eden):** `/train` and `/rest` in Telegram, with the board open in monday → the values change at once.
- [ ] **Step 6: Commit** `feat(telegram): /train and /rest with the v1 rules`.
- [ ] **Explain:** why the rule code is imported, not copied, and why we re-read before writing.

---

### Task 12: `/talk <pokemon>` with `run_prompt` (Feature 7)

**Branch:** `feat/telegram-talk`

**Files:**
- Modify: `server/src/telegram/commands.ts` + test

**Interfaces:**
- Consumes: `buildTalkPrompt`, `pokeApi.getSpecies`, `gateway.runPrompt` (config `{ model: 'MONDAY_FAST', system_prompt, temperature: 0.8, max_tokens: 60 }`, API `2026-10`), `talkFallbackText`.
- Produces: the handler `talk` → `"<name>: <reply>"`. On a `run_prompt` failure → `talkFallbackText(name)`, and the event gets `talkFailed: <error code>`.

- [ ] **Step 1: Write failing tests:**
  - `/talk Pikachu sends the buildTalkPrompt system prompt and user text to run_prompt`: assert on the fake gateway's received args
  - `the reply goes back to the chat`
  - `run_prompt failure → fallback text`
  - `unknown Pokémon → matchPokemon reply`
- [ ] **Step 2–4:** Run → FAIL → implement → PASS (`npm --prefix server run check`).
- [ ] **Step 5 (🧑 Eden):** `/talk charmander`. If `run_prompt` fails with the user token (the AI gateway permission), record the exact error in verify-early §16.
- [ ] **Step 6: Commit** `feat(telegram): /talk with run_prompt on the server`.
- [ ] **Explain:** the same prompt in two places, and the user token vs the iframe's seamless auth.

---

### Task 13: PokéAPI cache in key-value Storage (Feature 8)

**Branch:** `feat/server-pokeapi-cache`

**Files:**
- Create: `server/src/pokeapi/cache.ts` + test
- Modify: `server/src/deps.ts` (`pokeApiFor(userId)` now uses `KvCache`)

**Interfaces:**
- Produces:
  - `class KvCache implements PokeCache { constructor(kv: KvPort) }`.
    - `get` adds `cache: { hits, misses }` to the current event, and also the key list under `cacheKeys` (max 20).
    - `set` uses `ttl = POKEAPI_TTL_SECONDS = 2_592_000` (30 days, the Storage maximum).
    - Storage errors are logged and treated as a miss; they never fail the request.
  - `interface KvPort { get(key): Promise<{ success: boolean; value?: unknown }>; set(key, value, opts: { ttl: number }): Promise<{ success: boolean }> }`. The real one is `new Storage(accessToken)`.
  - Keys: `pk:v1:species:<dex>`, `pk:v1:evo:<dex>`, `pk:v1:moves:<dex>`, `pk:v1:move:<name>`, `pk:v1:types`, `pk:v1:gen1` (all ≤ 256 chars).

- [ ] **Step 1: Write failing tests:**
  - `miss → fetch → set with ttl 2592000 → hit on the second call`
  - `every event records hits and misses` (a `/talk` run twice: first miss, then hit)
  - `a Storage error is a miss, not a failure`
  - `gateway calls never go through the cache`: spy on the KV, then run `/roster` → no KV calls
- [ ] **Step 2–4:** Run → FAIL → implement → PASS.
- [ ] **Step 5:** Deployed: `/talk` twice → `mapps code:logs` shows `misses` and then `hits`.
- [ ] **Step 6: Commit** `feat(server): cache-aside PokéAPI in key-value storage with ttl`.
- [ ] **Explain:** cache-aside, TTL, and why game state is never cached.

---

### Task 14: Cron — hourly energy regen (Feature 9)

**Branch:** `feat/server-energy-cron`

**Files:**
- Create: `server/src/cron/energyRegen.ts` + test
- Modify: `server/src/app.ts`, `server/src/db/repos.ts` (`links.all()` as a cursor, `regenMarks.claim(boardId, hourKey): Promise<boolean>`)

**Interfaces:**
- Consumes: `applyRegen`, `TokenStore`, `createBoardGateway`, `Repos`.
- Produces:
  - `POST /mndy-cronjob/energy-regen` → `runEnergyRegen(deps)` inside `withEvent('cron', {job:'energy-regen', hourKey})`. It always returns 200.
  - `runEnergyRegen(deps): Promise<{ users: number; boards: number; changed: number; failures: { userId: string; reason: string }[] }>`. Steps:
    1. `hourKey = now.toISOString().slice(0,13)`.
    2. For each link (sequentially): `users.get` → skip if no boards (reason `NO_BOARDS`).
    3. `regenMarks.claim(pokemonBoardId, hourKey)` → skip if already claimed (another linked user on the same board, or a retry).
    4. `listPokemon` → patches via `applyRegen` (drop nulls) → one `updatePokemon` call.
    5. Wrap each user in try/catch: `ReconnectNeededError` → reason `RECONNECT`; anything else → the error name.

- [ ] **Step 1: Write failing tests:**
  - `every Pokémon below full gains +1 and full ones are untouched`
  - `Resting reaching full → Ready at level ≥ 5, Training below`
  - `works with no session: uses stored tokens`
  - `one user failing does not stop others`: user 1's token throws `ReconnectNeededError`, user 2 is still updated, and `failures` has user 1
  - `two linked users on the same board → that board is updated once this hour`
  - `a retried run in the same hour changes nothing`
  - `emits one cron event with users, boards, changed and failures`
- [ ] **Step 2–4:** Run → FAIL → implement → PASS.
- [ ] **Step 5 (🧑 Eden): promote and schedule.**
  1. `mapps app:promote -a <appId> -i <versionId>`. The job only runs on the **live** version. After that, new work goes to a new draft version, and CI's `MONDAY_APP_VERSION_ID` must point to it.
  2. `mapps scheduler:create -a <appId> -n energy-regen -s "0 * * * *" -e energy-regen -r 2 -t 240 -d "Hourly +1 Energy"`.
  3. `mapps scheduler:run -a <appId> -n energy-regen` → check the board and the cron event.
  4. Record the request headers the scheduler sends (names only) in verify-early §17.
- [ ] **Step 6: Commit** `feat(server): hourly energy regen cron for linked users`.
- [ ] **Explain:** live vs draft versions, and why per-board marks make a retry safe.

---

### Task 15: `/battle <gymA> <gymB>` from Telegram (Feature 10)

**Branch:** `feat/telegram-battle`

**Files:**
- Modify: `server/src/telegram/commands.ts` + test, `server/src/battle/service.ts` + test (`onBattleDone`)

**Interfaces:**
- Consumes: `splitTwoGyms`, `startBattle` (source `'telegram'`, `chatId`, the webhook event's `traceId`), `battleSummaryText`.
- Produces:
  - handler `battle`: it replies immediately `"⚔️ Battle started: <A> vs <B>…"`, or the error text.
  - `onBattleDone(deps, doc)`: if `doc.source === 'telegram' && !doc.resultSentAt` → `telegram.sendMessage(chatId, battleSummaryText(doc))` → set `resultSentAt`.

- [ ] **Step 1: Write failing tests:**
  - `/battle Cinnabar Cerulean replies at once and publishes one message`
  - `the queue run sends the summary to the same chat once, even when redelivered`
  - `board changes equal those of an app-started battle` (same seed and fixture → same patches)
  - `the battle appears in GET /api/battles for that board`
  - `the webhook, queue and Telegram-reply events share one traceId`
  - `/battle with one gym → usage; with an ambiguous split → the quote hint`
  - `there is no battle logic in telegram/`: a test greps `server/src/telegram/*.ts` for `simulateArena` and expects no match
- [ ] **Step 2–4:** Run → FAIL → implement → PASS.
- [ ] **Step 5 (🧑 Eden):** `/battle` in Telegram → the result message → the battle shows in the Arena's recent battles and replays.
- [ ] **Step 6: Commit** `feat(telegram): /battle through the shared engine and queue`.
- [ ] **Explain:** how one `traceId` follows webhook → queue → engine → reply.

---

### Task 16 (bonus): Battle card PNG in Object storage (Feature 11, experiment)

**Branch:** `feat/battle-card`

**Files:**
- Create: `server/src/card/renderCard.ts` + test
- Modify: `server/package.json` (`satori`, `@resvg/resvg-js`, `@fontsource/inter`), `server/src/battle/service.ts` (after the update post), `src/api/boards/gateway.ts` (`addFileToUpdate`), `docs/verify-early.md` §18

**Interfaces:**
- Produces:
  - `renderBattleCard(input: { gymA: string; gymB: string; winner: string | null; mvp: { name: string; spriteUrl?: string } | null }): Promise<Buffer>`. Satori input is built with plain `{type, props}` objects (no JSX toolchain), 800×418. The font is `@fontsource/inter/files/inter-latin-700-normal.woff` (satori does not read woff2). `new Resvg(svg).render().asPng()`.
  - Object storage name: `cards/<battleId>.png` (`uploadFile(name, buf, {contentType:'image/png'})`). `GET /api/battles/:id/card` (session, same account) streams `downloadFile`.
  - `gateway.addFileToUpdate(updateId, png, filename)` → multipart POST to `https://api.monday.com/v2/file` with `query = mutation ($file: File!) { add_file_to_update(update_id: <id>, file: $file) { id } }`.
  - Telegram: `sendPhoto(chatId, png, caption)` for Telegram battles.
  - The card is best-effort: any failure sets `cardError` on the event and the battle doc and never fails the battle.

- [ ] **Step 1: Write failing tests:**
  - `renderBattleCard returns a PNG` (first 8 bytes are `89 50 4E 47 0D 0A 1A 0A`) `under 10 MB`
  - `card failure does not fail the battle`
  - `uploads cards/<id>.png and sendPhoto gets the same buffer`
- [ ] **Step 2–4:** Run → FAIL → implement → PASS (locally).
- [ ] **Step 5 (🧑 Eden + Claude, the experiment):**
  - Deploy and check whether the resvg native binary loads on monday code (memory/time), whether `OBJECT_STORAGE_BUCKET` is set or object storage must be enabled in the Developer Center, and whether `add_file_to_update` works with the user token.
  - Write the findings in verify-early §18, whether it worked or not. That **is** the deliverable if it fails.
- [ ] **Step 6: Commit** `feat(server): battle result card with satori and resvg`.

---

### Task 17: Release

**Branch:** `docs/phase-2-release`

- [ ] **Step 1:** Run the acceptance checklist below against the deployed live version. Each line gets ✅ or the reason it isn't.
- [ ] **Step 2:** Update `README.md` (architecture diagram, env/secrets table, local dev), `docs/concepts.md` (OAuth/PKCE, sessionToken, queue idempotency, wide events, cron), and the `CLAUDE.md` verify commands.
- [ ] **Step 3:** Tag `v0.2.0` on the merged `main` commit (GIT_WORKFLOW §6).
- [ ] **Step 4: Commit** `docs: phase 2 architecture, runbook and verify-early results`.

**Acceptance checklist (from the spec):**
- F1: health on the deployed URL · config via SDK · one wide event per request, visible in `code:logs` and the Developer Center.
- F2: the app checks the token and starts OAuth · PKCE S256 + the new token URL · token in Secure Storage by user ID · `users` doc · every app call verified by sessionToken · the token is never in the front end or logs.
- F3: an engine module with no HTTP/Telegram · turns written during the simulation, and the replay is identical · a redelivered message gives one battle and one set of changes · the front end doesn't write after a battle · traceable by one ID.
- F4: code random, long, ≤ 64 chars, 10 min, single-use, user-bound · webhook secret enforced · friendly reply for unlinked chats · the "why" for each code property.
- F5–F7: live reads · helpful errors · inline replies · v1 rules · `run_prompt` with the user token, `2026-10`.
- F8: every PokéAPI call is cached with a TTL · no board cache · hit/miss in every event.
- F9: hourly on `/mndy-cronjob/...` · +1 Energy · Resting→(Ready/Training) at full · works with no one online · per-user isolation · a cron event · promoted to live.
- F10: an immediate reply · the shared engine · the result to the chat · visible in the Arena.
- F11: satori+resvg · Object storage · sendPhoto upload · attached to the update (or documented findings).

---

## Stretch (only after Task 17; each one is a branch and a commit)

- **S1 `/unlink`:** `links.deleteByChat(chatId)` → `texts.unlinked`. Tests: unlink, then `/gyms` → the notLinked reply. Unlinking an unlinked chat is a friendly no-op.
- **S2 Battle history view:** a "History" list in the Arena built on `listBattles(limit)` + `before` cursor paging (`createdAt`), which opens `BattleReplay`. Most of it already exists after Task 8.
- **S3 Daily digest:** a second cron job, `POST /mndy-cronjob/daily-digest` (`0 7 * * *` UTC), that sends each linked chat `/gyms`-style lines plus counts per status. It uses `tg_digest_marks` `<chatId>:<date>` for retry safety and keeps to the 1 msg/s per chat and 30 msg/s total limits (sequential sends, 40 ms apart).
- **S4 "Send to Telegram" workflow block:** a custom action feature that calls `POST /mndy-actions/send-to-telegram`, authorized by the integration JWT (signing secret). It sends the item name + a chosen column to the linked chat of the user who owns the automation. It needs a separate verify-early pass on the action payload before planning in detail.

## Execution notes

- Order: Task 2 can run in parallel with Task 1. Task 6 is pure and can run any time after Task 2. Everything else follows the spec order.
- Every server task uses `server/test/fakes.ts` (Task 3). No test calls monday, Telegram or PokéAPI over the network.
- Document DB budget per battle: about `turns + 6` writes and `turns + ~10` reads per replay. With `MAX_TURNS = 300` the worst case is about 300 writes, which allows over 60 worst-case battles a day inside the 20k limit, plus the cron job (1 mark per board per hour).
