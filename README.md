# Pokémon Gym Manager

A monday.com app for running Pokémon gyms. Its real purpose is to **learn monday app features, the monday API and monday code**. The game is the excuse.

- **v1 (`v0.1.0`):** a front-end-only app. React + TypeScript + Vite, shadcn/ui + Tailwind, `monday-sdk-js`, `@mondaydotcomorg/api` (`SeamlessApiClient`, API `2026-10`) and [PokéAPI](https://pokeapi.co) (Gen 1 only).
- **Phase 2 (`v0.2.0`):** a server on monday code (Node 22, Express 5) with OAuth 2.1, Document DB, the Queue, key-value and Object storage, a scheduler, and a Telegram bot (@eden_gym_bot).

## Status

| Spec | Feature | Route | State |
|---|---|---|---|
| 6.1 | Item view: Pokémon profile (live refresh) | `#/item-view` | ✅ works in monday |
| 6.7 | Talk to your Pokémon (`run_prompt`) | inside 6.1 | ✅ works in monday |
| 6.2 | Board view: gym roster with status filter | `#/board-view` | ✅ works in monday |
| 6.3 | Dashboard widget: gym and status stats | `#/widget` | ✅ works in monday (one or both boards) |
| 6.4 | Board multi-item menu: Spar / Transfer | `#/spar`, `#/transfer` | ✅ works in monday |
| 6.5 | Status column dialog: transitions, Rest, Evolve | `#/column-view` | ✅ works in monday |
| 6.6 | Gym HQ: create gym, recruit, battle | `#/gym-hq` | ✅ works in monday as a board view ("Gym HQ View"), by decision instead of a custom object |
| — | Deploy to monday code | — | ✅ every feature loads from monday code (client-side CDN), deployed by GitHub Actions on each merge to `main` |

**Phase 2 (server + Telegram), all live on the live version (`v0.2.0`):**

| # | Feature | Where | State |
|---|---|---|---|
| F1 | Server on monday code, one wide event per request | `server/` | ✅ |
| F2 | Connect to monday: OAuth 2.1 + PKCE, token in Secure Storage, sessionToken on every app call, Reconnect | Gym HQ → Connect | ✅ |
| F3 | Arena on the server: queue, Document DB, turn-by-turn replay | Gym HQ → Arena | ✅ |
| F4 | Link a Telegram chat (one-time code) | Gym HQ → Connect | ✅ |
| F5–F7 | `/gyms`, `/roster`, `/train`, `/rest`, `/talk` | Telegram | ✅ |
| F8 | PokéAPI cache in key-value Storage (30-day TTL) | server | ✅ |
| F9 | Hourly Energy refill (scheduler) | server | ✅ (see "Phase 2 acceptance") |
| F10 | `/battle` from Telegram through the same engine and queue | Telegram | ✅ |
| F11 | Battle card PNG (satori + resvg-wasm) in Object storage, on the updates and in Telegram | server | ✅ |

## Phase 2 acceptance (`v0.2.0`, checked on the live version on 2026-11-25)

The plan's acceptance checklist, checked with the trimmed scopes and a fresh token. Findings: `docs/verify-early.md` §13–§22.

- **F1:** ✅ `/health` on the `liveUrl`. Config comes through the SDK. One wide event per request, visible in `code:logs` and in the Developer Center.
- **F2:** ✅ the Connect tab starts OAuth 2.1 with PKCE S256 and the new token URL. The token lives in Secure Storage by user id, with a `users` doc. Every app call is checked by sessionToken. The token never reaches the front end or the logs.
- **F3:** ✅ the engine (`src/game/arena.ts`) has no HTTP or Telegram code. Turns are written while it runs, and the replay is identical. A redelivered message gives one battle and one set of changes. The front end doesn't write after a battle. One `traceId` follows the battle.
- **F4:** ✅ the link code is random, 43 characters, valid for 10 minutes, single use and bound to the user. The webhook secret is enforced. An unlinked chat gets a friendly reply.
- **F5–F7:** ✅ live reads, helpful errors, replies in the chat, the v1 rules, and `run_prompt` with the user's token on API `2026-10`.
- **F8:** ✅ every PokéAPI call is cached with a TTL. There's no board cache. Hits and misses appear on every event.
- **F9:** ✅ the job `energy-regen` runs hourly on `/mndy-cronjob/energy-regen` against the live version. `scheduler:run` reached v3 with the trimmed token (`failures: []`), and a duplicate delivery was skipped by the hour mark. The +1 Energy and the Resting → Ready/Training rules are covered by the tests, and were seen on the board in Task 14. Not re-observed on the board after the release: the 2026-11-25 manual run found nothing to change (`changed: 0`), and the next hourly run was not checked.
- **F10:** ✅ an immediate reply, the shared engine and queue, the result in the chat, and the battle visible in the Arena.
- **F11:** ✅ satori + resvg-wasm, Object storage, `sendPhoto` with the summary as caption, and the card attached to the updates on both gyms.

## How it is built

```
screens (src/features/*)  ──▶  GameApi contract (src/api/GameApi.ts)  ──▶  MockGameApi (src/api/mock)   in tests / ?mock=1
                                                                    └─▶  MondayGameApi (src/api/monday) in monday
game rules (src/game/*): pure functions with tests (status, roster, evolution, battle, arena, stats, talk)
```

Phase 2 adds a server. The app and the bot share the board code (`src/api/boards`) and the rules (`src/game`):

```
monday (Gym HQ, iframe) ──sessionToken──▶ server/  (Express on monday code, liveUrl live1-…)
Telegram ──webhook + secret──────────────▶   ├─ /api/*            app calls (requireSession)
                                              ├─ /oauth/callback   OAuth 2.1 + PKCE → Secure Storage (per user)
                                              ├─ /telegram/webhook /gyms /roster /train /rest /talk /battle
                                              ├─ /mndy-queue       battles: claim → simulate → board → update + card
                                              └─ /mndy-cronjob/…   hourly Energy refill
   server ──user's OAuth token──▶ monday GraphQL (+ /v2/file)   ──▶ PokéAPI (cached in key-value Storage)
   Document DB: users, links, oauth_states, link_codes, tg_updates, battles, battle_turns, regen_marks
   Object storage: cards/<battleId>.png
```

- Screens never talk to monday directly. They call one `api` object, so every screen also runs against an in-memory mock.
- No board, item or column IDs are hardcoded. Columns are found by **title**, boards come from the context or from the saved board config.
- Each monday feature points to its own hash route of the same app.

## Run it

```bash
npm install
npm run dev            # http://localhost:5173
```

**Without monday (mock data):** open a route with `?mock=1`, for example:
- `http://localhost:5173/#/item-view?mock=1&itemId=p1`
- `http://localhost:5173/#/board-view?mock=1`
- `http://localhost:5173/#/widget?mock=1&widgetBoardIds=b1,b2`
- `http://localhost:5173/#/spar?mock=1&selectedItemIds=p1,p2`
- `http://localhost:5173/#/column-view?mock=1&itemId=p1`
- `http://localhost:5173/#/gym-hq?mock=1`

**Inside monday:** every feature points at monday code (`mapps app-features:build --buildType monday_code_cdn --customUrl "#/<route>"`). The CD workflow uploads each merge to `main`, so nothing needs to run locally.

**Inside monday with local changes (tunnel):** to try changes before they reach `main`, run a tunnel and point a feature back at it:
```bash
mapps tunnel:create -p 5173 -a <APP_ID>
```
Set each feature's URL in the Developer Center to `<tunnel URL>/#/<route>` and **save it**. A development app is not installed, so its features are only reachable this way:

| Feature | Where to find it in monday |
|---|---|
| Item view | the item card's **+** tab → the app |
| Board view | Views **+** → Views Center → **Development Apps** → Open in board |
| Dashboard widget | Add widget → **Development Apps** |
| Multi-item menu | select items → Apps → **search the feature name** |
| Status column | Add column **+** → More columns → Column Center → **Development Apps** → Add to board |
| Gym HQ (as a board view) | on the Gyms board: Views **+** → Explore more views → **Development Apps** → "Gym HQ View" → Open in board. A new view shows up only after a hard refresh |

The app needs OAuth scopes (Developer Center → Build → OAuth & permissions). See `docs/verify-early.md` §3.

## Server (Phase 2)

`server/` is a Node.js + TypeScript server (Express 5) for monday code. It has its own `package.json`. esbuild bundles it, together with the shared rules from `src/game/`, into `server/dist/index.js`. monday code only receives the `server/` folder, so the bundle is built before every push.

```bash
cp server/.env.example server/.env   # fill in the values (never commit .env)
npm --prefix server install
npm --prefix server run dev          # http://localhost:8080/health, reloads on save
```

With `npm run dev` running as well, the Vite dev server forwards `/api`, `/oauth` and `/telegram` to the local server, so the one tunnel on port 5173 reaches both.

Deploy by hand: `npm --prefix server run bundle && mapps code:push --directoryPath server --appId <APP_ID> --appVersionId <APP_VERSION_ID>`. The server reads its settings through the monday code SDK:

| Key | Kind | What |
|---|---|---|
| `MONDAY_CLIENT_ID` | env (`mapps code:env`) | the app's OAuth client id |
| `SERVER_BASE_URL` | env | the server's public URL; `<it>/oauth/callback` must be a registered redirect URL. Live: the `liveUrl` |
| `TELEGRAM_BOT_USERNAME` | env | `eden_gym_bot` |
| `MONDAY_CLIENT_SECRET` | secret (`mapps code:secret`) | OAuth client secret; also verifies the app's sessionToken (HS256) |
| `TELEGRAM_BOT_TOKEN` | secret | the bot's token |
| `TELEGRAM_WEBHOOK_SECRET` | secret | checked on every webhook call (`X-Telegram-Bot-Api-Secret-Token`) |
| `MNDY_MONGODB_CONNECTION_STRING`, `OBJECT_STORAGE_BUCKET`, `PORT` | set by monday code | Document DB, Object storage, port |

Env and secrets belong to the app, but a version only reads them on its next `code:push`. Locally they come from `server/.env`.

Point the bot at a server (also sets the command menu): `npm --prefix server run webhook:set -- "<server URL>"`.

## Releasing a version

Each version has its own server URL (`https://<hash>-service-…`), and the **live** version is also served on a fixed `liveUrl` (`https://live1-service-1102328-b5e4eb12.us.monday.app`), which moves to every newly promoted version. The bot webhook, the OAuth redirect URL, `SERVER_BASE_URL` and the CI variable `SERVER_URL` all point at the `liveUrl`.

1. Merge to `main` → CI deploys the app and the server to the draft version (`MONDAY_APP_VERSION_ID`).
2. Check the draft, then `mapps app:promote --appId <APP_ID> --appVersionId <draft>`. A live version is locked.
3. Create the next draft in the Developer Center (it copies the scopes), then `gh variable set MONDAY_APP_VERSION_ID --body "<new draft>"`.
4. If the OAuth scopes changed: Gym HQ → Connect → **Reconnect to monday**, so the server gets a token with them.
5. Tag the merged commit (`docs/GIT_WORKFLOW.md` §6).

The scheduler job (`energy-regen`, hourly) calls the live deployment, so it follows the promotion by itself.

## Checks

```bash
npx vitest run        # 293 tests
npm run typecheck
npm run build
npm --prefix server run check   # server: typecheck, tests, bundle
```

GitHub Actions runs the same checks, plus `npm run lint`, on every PR and every push to `main` (`.github/workflows/ci.yml`).

After those checks pass on `main`, `.github/workflows/deploy.yml` pushes `dist/` to monday code (`mapps code:push --client-side`) and the bundled `server/` (`mapps code:push`) for the draft version. It needs the secret `MONDAY_TOKEN` and the variables `MONDAY_APP_ID` and `MONDAY_APP_VERSION_ID` in the repo settings.

## Docs

- `docs/concepts.md`: which monday concept each feature uses, and why.
- `docs/verify-early.md`: what monday, monday code, Telegram and PokéAPI really do (context, column value shapes, write formats, storage, run_prompt, OAuth, Document DB, the queue, the scheduler, Object storage, releases).
- `docs/GIT_WORKFLOW.md`: branches, commits and PRs.
- `docs/superpowers/specs/…-design.md` and `docs/superpowers/plans/…md`: the design and the task-by-task plan.

## Open items

- `listPokemon` filters gym/status client-side; server-side `query_params` would need the Status column ID.
- The client CDN serves `index.html` with a 1-year cache, so a user may keep an old app after a deploy until a hard refresh (`docs/verify-early.md` §17).
- The scheduler route is open (the hour marks cap it at +1 per board per hour); checking the scheduler's `authorization` token would lock it.
- Stretch ideas from the Phase 2 plan: `/unlink`, a battle history view, a daily digest, a "Send to Telegram" workflow block.
