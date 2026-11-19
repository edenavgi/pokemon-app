# Pokémon Gym Manager — Design (Claude ↔ Eden split)

Source spec: `~/Desktop/Pokémon Gym Manager — App Spec for Eden.pdf`

## Context / intent

A front-end-only monday app (React + TS + Vite, shadcn/ui + Tailwind) for running Pokémon gyms. Its real purpose is **learning**: Eden learns the monday app feature types, the monday SDK and the GraphQL API. The game itself is the excuse.

Eden decided how the work is split:
- **Claude builds the React UI**: every screen, including its local state, loading/error/empty states and user interactions. Claude also writes the **pure game rules** with tests.
- **Eden builds everything that talks to monday**: SDK context and listen, GraphQL queries and mutations, filtering and caching, storage, `execute("notice")`, `run_prompt`, PokéAPI fetching and caching, manifest/feature setup, the tunnel and the deploy.
- The boundary is **one `api` object** (`GameApi` interface). Claude's screens call only `api.*`. Eden implements `MondayGameApi`.

## Goals / non-goals / anti-goals

- **Goals:** all features 6.1–6.6 work against real boards; 6.7 works or its failure is documented; Eden can explain each monday concept used.
- **Non-goals:** a server, backend routes, cron or custom automation blocks; generations beyond Gen 1 (#1–151); stretch items (section 7 of the spec) unless asked later.
- **Anti-goals:** Claude writing any SDK/GraphQL/PokéAPI fetch code, since that would defeat Eden's learning. Screens that only work with mocks because the contract hid real data shapes. Hardcoded board, item or column IDs anywhere in the UI.

## Approaches considered

1. Pure presentational components (props in, callbacks out); Eden writes containers/hooks. *Not chosen.*
2. Hook contract (`usePokemonItem` etc.) that Eden implements. *Not chosen.*
3. **One `api` object. Claude writes full screens with state; Eden implements fetch/mutate behind the interface. ← Eden's pick.** Trade-off: Eden writes less React state code, but the monday learning (context, GraphQL, mirror/connect shapes, caching, mutations, AI) stays fully Eden's.

## Architecture

```
src/
  main.tsx                 # mounts <ApiProvider api=...><Router/></ApiProvider>
  router.tsx               # path → feature screen (/item-view, /board-view, /widget,
                           #   /board-menu/spar, /board-menu/transfer, /column-view, /gym-hq)
  api/
    GameApi.ts             # THE CONTRACT (types + interface) — Claude drafts, Eden approves
    ApiProvider.tsx        # React context + useApi()
    mock/MockGameApi.ts    # in-memory impl + Gen-1 fixtures (Claude) — for dev & tests
    monday/                # MondayGameApi (Eden only)
  game/                    # pure rules + Vitest tests (Claude)
  features/<feature>/      # screens (Claude)
  components/ui/           # shadcn components
```

- `main.tsx` chooses the API implementation: `?mock=1` or `VITE_USE_MOCK` → `MockGameApi`, otherwise Eden's `MondayGameApi`. That way every screen runs in a normal browser before Eden's side is ready.
- One Vite app and one build. Each monday feature points to its own **hash route** (`<url>/#/item-view`, …). The hash is used because monday code client-side hosting serves a single `index.html`, so path-based routes might return a 404. Eden configures the features. *(Claude's call, added while writing the plan.)*

### `GameApi` contract (draft, to be finalised together before screens)

```ts
type Status = 'Recruited' | 'Training' | 'Ready' | 'Resting';
interface Pokemon { id; name; dexNumber; types: PokeType[]; spriteUrl;
  hp; attack; defense; speed; level; energy; status: Status;
  gym: { id; name; type: PokeType } | null }
interface Gym { id; name; type: PokeType; roster: Pokemon[] }   // roster order = battle order
interface AppContext { kind: 'item'|'board'|'widget'|'boardMenu'|'column'|'object';
  boardId?; itemId?; columnId?; selectedItemIds?; widgetBoardIds?; theme }

interface GameApi {
  // board config (Eden: SDK storage + boards query). No hardcoded IDs.
  listBoards(): Promise<{ id; name }[]>;
  getBoardConfig(): Promise<{ gymsBoardId; pokemonBoardId } | null>;
  setBoardConfig(cfg: { gymsBoardId; pokemonBoardId }): Promise<void>;
  // context (SDK)
  getContext(): Promise<AppContext>;
  onContextChange(cb): Unsubscribe;
  onItemChanged(itemId, cb): Unsubscribe;          // monday.listen-backed refresh
  // reads (GraphQL)
  getPokemon(itemId): Promise<Pokemon>;
  getPokemonMany(itemIds): Promise<Pokemon[]>;
  listPokemon(opts?: { boardIds?; gymId?; status? }): Promise<Pokemon[]>; // widget (Pokémon board only) + filters
  listGyms(opts?: { boardIds? }): Promise<Gym[]>;   // includes rosters/mirrored levels
  getGym(gymId): Promise<Gym>;
  // writes (GraphQL)
  createGym(input: { name; type }): Promise<Gym>;
  recruit(input: { species: SpeciesDetail; gymId }): Promise<Pokemon>;  // creates item + links gym
  updatePokemon(patches: { id; patch: Partial<Pokemon> }[]): Promise<void>; // batched
  setGym(pokemonIds, gymId): Promise<void>;
  postUpdate(itemId, body: string): Promise<void>;
  notify(message, type: 'success'|'error'|'info'): void;   // execute("notice")
  closeFeature(): void;                             // close menu modal / column dialog
  // PokéAPI (Eden fetches + caches)
  listGen1(): Promise<SpeciesSummary[]>;            // dex, name, types, sprite
  getSpecies(dexNumber): Promise<SpeciesDetail>;    // stats, types, sprite, flavor text
  getEvolution(dexNumber): Promise<EvolutionInfo>;  // stage (1/2/3) + level-based next form or null
  getTypeChart(): Promise<TypeChart>;               // damage relations for 18 types
  // AI
  talk(prompt: { system: string; user: string }): Promise<string>; // run_prompt
}
```

Screens never assume the raw monday shapes. Mapping mirror/connect/dropdown JSON into these types is Eden's work, and it is the "verify early" lesson.

## Game rules (`src/game/`, pure, Vitest)

| Function | Rule |
|---|---|
| `canJoinGym(p, gym)` | gym.type ∈ p.types AND roster < 6 (a transfer within the same gym is a no-op) |
| `validateSpar(a, b)` | exactly 2, same gym, both energy ≥ 1, neither Resting |
| `applySpar(p)` | level+1, energy−1, status = `deriveStatus` |
| `deriveStatus(p)` | energy 0 → Resting; level ≥ 5 → Ready; else Training |
| `applyRest(p)` | energy = 3, status = level ≥ 5 ? Ready : Training |
| `allowedTransitions(p)` | rules for the column dialog (below) |
| `evolutionCheck(p, evo)` | stage 1 → 2 at level ≥ 3, stage 2 → 3 at level ≥ 6, level-based only, target dex ≤ 151 |
| `applyEvolution(p, species)` | replace name/sprite/stats/types; keep level, gym, status, energy |
| `battle(gymA, gymB, chart, rng)` | spec §5 with an injectable rng (deterministic tests) |
| `gymStats(gyms, pokemon)` | widget aggregates: count per gym/status, avg level |
| `buildTalkPrompt(species)` | system prompt from name, types and English flavor text |

**Claude's calls (correct me):**
- **Status after spar (spec: "moves to Training"):** spar sets Training, and then the two automatic rules from spec §5 override it: energy 0 → Resting, and level ≥ 5 → Ready. That is `deriveStatus`.
- **Status dialog, manual transitions:** Recruited→Training. Training→Ready only if level ≥ 5. Ready→Training (bench the Pokémon). Training or Ready→Resting (voluntary rest). Resting has no manual move, only the **Rest** action. Automatic transitions (energy 0 → Resting) are applied by the code that changes energy, not by the dialog.
- **Round score:** each Pokémon in a pair scores as the attacker against the other: `(attack + speed + hp) × (1 + level/10) × effectiveness × luck(0.8–1.2)`. **Effectiveness** is the attacker's best type against the defender's **primary type**, so the values are only 2/1/0.5/0, exactly as in the spec. If two scores are exactly equal, the round is a draw: no win for either side, but it counts toward the total score.
- **Pairing:** each gym fields its eligible Pokémon (Ready, energy ≥ 1) in roster order. The number of rounds is the size of the smaller team.
- **Evolution:** the dialog shows Evolve only when `evolutionCheck` passes. Evolving does not change level-based status.
- **Widget connected to one board:** with only the Gyms board, it shows count and average level per gym (from the mirror). The status section shows "connect the Pokémon board to see status". With only the Pokémon board, it shows everything, using gym names from the connect column and levels from Level. `api.listGyms` / `api.listPokemon` take `boardIds` from the widget context.

## Screens (Claude)

| Spec | Screen | Key UI |
|---|---|---|
| setup | BoardSetup (shared) | shown when `getBoardConfig()` is null: two board pickers (Gyms / Pokémon), Save. Used by Gym HQ and by any screen that needs the other board |
| 6.1 | ItemView: Pokémon profile | sprite, name, type badges, stat bars, level/energy/status, gym; live refresh via `onItemChanged`; **Talk** button + reply bubble + friendly fallback (6.7) |
| 6.2 | BoardView: gym roster | gym selector → card grid (sprite, name, level, status); status filter chips |
| 6.3 | Widget: stats | per-gym table (count, avg level), per-status counts; works with 1 or 2 boards |
| 6.4 | BoardMenu: Spar / Transfer | modal: validation result, confirm; transfer = gym picker with disabled reasons; errors via `api.notify` |
| 6.5 | ColumnView: Status dialog | allowed transitions, Rest button, Evolve button (with a preview of the next form); writes via `api.updatePokemon`, then `api.postUpdate` |
| 6.6 | GymHQ | tabs: Gyms (create + browse rosters), Recruit (search + type filter + gym picker with rule errors), Arena (two gyms → Battle → round table, winner highlighted → post update to both). Built as a **board view**, not a custom object (decision 2026-11-19: custom objects need an install, `verify-early.md` §10) |

Every screen has loading, empty and error states, uses shadcn components and follows the monday theme (light/dark) from context.

## "Verify early" (missing from the spec: sections 7/8 are mixed up)

The spec mentions these checks but never defines them. Proposed list for **Eden**, with findings written to `docs/verify-early.md`:
1. What `getContext()` returns in each feature type (item, board, widget, board menu, column, object).
2. The GraphQL shape of the connect-boards, mirror (`display_value` / `MirrorValue`), dropdown, status and link columns.
3. Whether `SeamlessApiClient` with API version 2026-10 works from the iframe.
4. Whether `run_prompt` works from the browser (scope `AI:Consume`, AI gateway permission).
5. How column view, board menu and custom object are registered, and what URL each one loads.

## What the builder decides

shadcn component choices, visual styling, file-level structure inside `features/`, mock fixture contents, and the exact wording of validation messages.

## Work order (to be detailed with writing-plans)

0. Project folder: **Eden creates a local folder and a GitHub repo and sends both paths**. Claude then moves the session there, and this design doc is saved to `docs/superpowers/specs/2026-11-17-pokemon-gym-manager-design.md`. Scaffold Vite, Tailwind and shadcn. Draft the `GameApi` contract, **reviewed by Eden**. Write `MockGameApi` with fixtures.
1. `src/game/` rules with full Vitest coverage.
2. Screens in spec order (6.1 → 6.6, with 6.7 inside 6.1), each runnable against the mock (`npm run dev` with `?mock=1`).
3. Eden's track runs in parallel: verify-early, then `MondayGameApi` method by method, the manifest and the deploy. Claude answers questions and reviews only when asked.

## Verification

- `npx vitest run`: all game rules pass, including a deterministic battle with a seeded rng.
- `npm run dev` + `?mock=1`: every route renders and every interaction works against the mock (checked in the browser pane).
- `npm run build` and `tsc --noEmit` are clean.
- End to end (Eden): each feature inside monday against the real boards, checked against the acceptance criteria in spec §6.
