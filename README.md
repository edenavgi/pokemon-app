# Pokémon Gym Manager

A front-end-only monday.com app for running Pokémon gyms. Its real purpose is to **learn monday app features and the monday API**. The game is the excuse.

Built with React + TypeScript + Vite, shadcn/ui + Tailwind, `monday-sdk-js`, `@mondaydotcomorg/api` (`SeamlessApiClient`, API `2026-10`) and [PokéAPI](https://pokeapi.co) (Gen 1 only).

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
| — | Deploy to monday code | — | ❌ not done (plan Task 23); runs from a dev tunnel |

## How it is built

```
screens (src/features/*)  ──▶  GameApi contract (src/api/GameApi.ts)  ──▶  MockGameApi (src/api/mock)   in tests / ?mock=1
                                                                    └─▶  MondayGameApi (src/api/monday) in monday
game rules (src/game/*): pure functions with tests (status, roster, evolution, battle, stats, talk)
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

**Inside monday (development):**
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

## Checks

```bash
npx vitest run        # 214 tests
npm run typecheck
npm run build
```

## Docs

- `docs/concepts.md`: which monday concept each feature uses, and why.
- `docs/verify-early.md`: what monday and PokéAPI really return (context, column value shapes, write formats, storage, run_prompt, evolution chains, custom objects, creating items, type lists).
- `docs/GIT_WORKFLOW.md`: branches, commits and PRs.
- `docs/superpowers/specs/…-design.md` and `docs/superpowers/plans/…md`: the design and the task-by-task plan.

## Open items

- Deploy to monday code: plan Task 23.
- Trim the OAuth scopes to the minimum before anyone installs the app.
- `listPokemon` filters gym/status client-side; server-side `query_params` would need the Status column ID.
- `getGym` is not implemented (no screen uses it yet).
