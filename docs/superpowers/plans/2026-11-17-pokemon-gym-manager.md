# Pokémon Gym Manager — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (**chosen by Eden on 2026-11-17**) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Only tasks marked 🤖 Claude are carried out by an agent.** Tasks marked 🧑 Eden are Eden's learning tasks, and no agent writes code for them (anti-goal in the design).

**Goal:** A front-end-only monday app with 7 features (Item view, Board view, Widget, two Board menu actions, Status column view, Custom object) for managing Pokémon gyms, built so that Eden learns the SDK and the monday API.

**Architecture:** One Vite app with hash routes, one route per monday feature. Every screen talks only to a `GameApi` object that it receives through React context. Claude writes the screens, `MockGameApi` and the pure game rules (`src/game/`). Eden writes `MondayGameApi` (SDK + GraphQL + PokéAPI + storage + run_prompt).

**Tech Stack:** React 18 + TypeScript + Vite, Tailwind CSS + shadcn/ui, Vitest + React Testing Library, monday-sdk-js, @mondaydotcomorg/api (SeamlessApiClient), PokéAPI v2, mapps CLI ≥ 4.6.0.

**Spec:** `docs/superpowers/specs/2026-11-17-pokemon-gym-manager-design.md` (and the original PDF: `~/Desktop/Pokémon Gym Manager — App Spec for Eden.pdf`)

## Global Constraints

- Front end only: no server, no backend routes, no cron jobs, no custom automation blocks.
- Gen 1 only: `dexNumber` from 1 to 151, including evolution targets.
- monday API version: `2026-10` or later.
- `run_prompt`: model `MONDAY_FAST`, low `max_tokens` (~60), `temperature` 0.8. Scope `AI:Consume`.
- No hardcoded board, item or column IDs anywhere in `src/` (except mock fixtures).
- Rule values (in `src/game/constants.ts` only): `MAX_ROSTER = 6`, `MAX_ENERGY = 3`, `READY_LEVEL = 5`, `EVOLVE_LEVEL = { 1: 3, 2: 6 }`, `LUCK_MIN = 0.8`, `LUCK_MAX = 1.2`, `START_LEVEL = 1`.
- Status labels, exactly: `Recruited`, `Training`, `Ready`, `Resting`.
- The 18 type labels, exactly: `Normal, Fire, Water, Grass, Electric, Ice, Fighting, Poison, Ground, Flying, Psychic, Bug, Rock, Ghost, Dragon, Dark, Steel, Fairy`.
- An invalid action changes nothing: validate everything before the first mutation.
- Screens import only from `src/api/GameApi.ts`, never from `src/api/monday/`.

## Review Focus

1. **The same Pokémon twice in Spar/Transfer, or a selection that mixes items from another board.** Expected: a clear rejection and nothing changes. Tested in Task 5 (`validateSpar` with duplicate ids) and Task 12.
2. **Transfer that would push a gym over 6 when several Pokémon are moved together.** Expected: the whole move is blocked, not a partial one. Tested in Task 6 (`validateTransfer` with an incoming batch).
3. **A Pokémon whose next form is outside Gen 1, or a branching evolution (Eevee).** Expected: no Evolve button. Tested in Task 7.
4. **Battle where one gym has no eligible Pokémon (all Resting or energy 0).** Expected: an error message and no update is posted. Tested in Task 8 and Task 15.
5. **An item whose values change while its screen is open (another user, or an automation).** Expected: the screen refreshes without a reload. Tested in Task 3 (mock listeners) and Task 11.

---

# Part 0: Preparation before any code (🧑 Eden)

The goal of this part: when Part 1 starts, monday already has the boards, the app and the features, and you have a token, an empty repo and a working VS Code. Do each step in order, and mark it once its "done when" holds.

### Step 0.1: Workspace and accounts
- [ ] Log in to your developer account and create a dedicated workspace called `Pokémon League`, so the game boards don't get mixed into real work.
- [ ] Check: `mapps --version` shows **4.6.0 or higher** (needed for `code:push -c`). If not: `npm i -g @mondaycom/apps-cli`.
- [ ] Check: `node -v` shows 20 or higher.
- **Done when:** the workspace exists and both commands pass.

### Step 0.2: API token and CLI
- [ ] Avatar → **Developers** → **My access tokens** → copy the token. **Don't paste it into code, git or a chat.**
- [ ] Run `mapps init -t <TOKEN>` in a terminal.
- **Done when:** `mapps app:list` returns a list (even an empty one) without an error.

### Step 0.3: Build the boards by hand (the order matters)
Connect boards requires both boards to exist, and Mirror requires a Connect column. So:
1. [ ] **Gyms board** (empty). Columns: `Type`, a **Dropdown** with the 18 labels from Global Constraints. Delete any default columns that aren't in the spec.
2. [ ] **Pokémon board.** Columns:
   - `Pokédex number`, `HP`, `Attack`, `Defense`, `Speed`, `Level`, `Energy`: **Numbers**
   - `Types`: **Dropdown** (multiple selection allowed) with the same 18 labels
   - `Sprite`: **Link**
   - `Status`: **Status**. Delete the default labels (Working on it / Done / Stuck) and create exactly `Recruited`, `Training`, `Ready`, `Resting`.
3. [ ] On the Pokémon board, add `Gym`: **Connect boards** → the Gyms board. Turn on the option to create the matching column on the other board (two-way), then rename the column it creates on Gyms to `Pokémon`.
4. [ ] On Gyms, add `Level (mirror)`: **Mirror** → through the `Pokémon` column → the `Level` column.
5. [ ] On Pokémon, add `Gym type (mirror)`: **Mirror** → through `Gym` → `Type`.
- **Done when:** both boards match the tables in the spec, sections 4–5, exactly.

### Step 0.4: Seed data by hand
- [ ] On Gyms: `Cinnabar Gym` (Fire) and `Cerulean Gym` (Water).
- [ ] On Pokémon: `Charmander` (#4, Fire, HP 39, Atk 52, Def 43, Spd 65, Level 1, Energy 3, Recruited, linked to Cinnabar). Also `Squirtle` (#7, Water, 44/48/65/43, linked to Cerulean). Sprite: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/<dex>.png`.
- **Done when:** `Level (mirror)` on Cinnabar Gym shows 1.

### Step 0.5: First look at the API (the start of "verify early")
- [ ] Open the **API Playground** (in the Developer Center, or through `developer.monday.com`), select version `2026-10`, and run a query on the Pokémon board's items with `column_values { id type text value ... on MirrorValue { display_value } ... on BoardRelationValue { linked_item_ids } }`.
- [ ] Copy the full response into `docs/verify-early.md` (create it once the repo exists in Step 0.8). Mark what `text` returns compared with `display_value` for a mirror, and what `value` returns for a connect.
- **Done when:** you can explain in one sentence how to read the gym's average level.

### Step 0.6: Create the app in the Developer Center
- [ ] Developers → **Create app** → name it `Pokémon Gym Manager`.
- [ ] **OAuth & Permissions** → scopes: `boards:read`, `boards:write`, `updates:write`, `me:read`, `workspaces:read`, `AI:Consume`.
- [ ] Write down the **App ID** and the **App Version ID** (the draft). They go in `.env.local` only (Step 0.8), never into git.
- **Done when:** the app exists with these scopes.

### Step 0.7: Create the 7 features (URLs are filled in later, in Task 10)
| Feature type in the Developer Center | Name | Route that will be filled in later |
|---|---|---|
| Item view | Pokémon Profile | `#/item-view` |
| Board view | Gym Roster | `#/board-view` |
| Dashboard widget | Gym Stats | `#/widget` |
| Board menu → **Board multi-item menu** | Spar selected | `#/spar` |
| Board menu → **Board multi-item menu** | Transfer to gym | `#/transfer` |
| Column → **Status column** → *On Click Dialog* | Status & Evolve | `#/column-view` |
| Object | Gym HQ | `#/gym-hq` |
- **Done when:** all 7 appear in the Features tab (even with no URL yet).

### Step 0.8: Local folder, GitHub and VS Code
- [ ] Create a local folder and an **empty** GitHub repo (no README), and connect them with `git remote add origin ...`.
- [ ] Open the folder in VS Code and install the Claude Code extension.
- [ ] Send Claude the two paths. Claude will move the session there and copy `docs/` from this session.
- **Done when:** `git remote -v` shows the repo, and Claude confirms it has moved to the folder.

---

# Part 1: Infrastructure

### Task 1 🤖 Claude: Scaffold + router + test setup

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`, `src/main.tsx`, `src/router.tsx`, `src/index.css`, `components.json`, `src/components/ui/*` (button, card, badge, dialog, select, tabs, input, table, progress, alert), `vitest.setup.ts`, `.gitignore`, `.env.example`
- Test: `src/router.test.tsx`

**Interfaces:**
- Produces: `ROUTES = ['item-view','board-view','widget','spar','transfer','column-view','gym-hq','setup'] as const`, `type RouteName`, `<Router />` (reads `location.hash`, listens for `hashchange`, unknown → `NotFound`).

- [ ] **Step 1:** Run `npm create vite@latest . -- --template react-ts`, install Tailwind (`@tailwindcss/vite`), run `npx shadcn@latest init`, and add the components listed above. Install `vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom`. Add the scripts `"test": "vitest"` and `"typecheck": "tsc -b --noEmit"`.
- [ ] **Step 2:** `vite.config.ts`: `server: { port: 5173, allowedHosts: true }` (needed for the mapps tunnel), `base: './'` (needed for monday code hosting), alias `@` → `src`, test env `jsdom`.
- [ ] **Step 3: Failing test.** `src/router.test.tsx`: for each `RouteName`, `location.hash = '#/'+name` → render `<Router routes={stubRoutes}/>` → `getByTestId('route-'+name)`. Also `'#/nope'` → `getByText('Unknown screen')`.
- [ ] **Step 4:** `npx vitest run src/router.test.tsx` → FAIL (`Router` not defined).
- [ ] **Step 5:** Implement `Router({ routes }: { routes: Record<RouteName, ComponentType> })` in `src/router.tsx`.
- [ ] **Step 6:** `npx vitest run` → PASS; `npm run build` → creates `dist/index.html`.
- [ ] **Step 7:** `.gitignore` includes `.env.local`, `.mappsrc`, `dist`. `.env.example` contains `VITE_USE_MOCK=1` (with no IDs). Commit: `chore: scaffold vite+react+shadcn with hash router`.

### Task 2 🤖 Claude: The contract, `GameApi.ts` (🧑 Eden review checkpoint)

**Files:**
- Create: `src/api/GameApi.ts`, `src/api/ApiProvider.tsx`
- Test: `src/api/ApiProvider.test.tsx`

**Interfaces (Produces, the exact contract):**
```ts
export const POKE_TYPES = [/* 18 labels exactly as in Global Constraints */] as const;
export type PokeType = typeof POKE_TYPES[number];
export const STATUSES = ['Recruited','Training','Ready','Resting'] as const;
export type Status = typeof STATUSES[number];
export type Id = string;
export interface GymRef { id: Id; name: string; type: PokeType | null }
export interface Pokemon { id: Id; name: string; dexNumber: number; types: PokeType[];
  spriteUrl: string; hp: number; attack: number; defense: number; speed: number;
  level: number; energy: number; status: Status; gym: GymRef | null }
export interface Gym { id: Id; name: string; type: PokeType | null;
  roster: Pokemon[]; mirroredLevels: number[] }           // roster order = battle order
export interface BoardConfig { gymsBoardId: Id; pokemonBoardId: Id }
export type ThemeName = 'light' | 'dark' | 'black';
export interface AppContext { theme: ThemeName; boardId?: Id; itemId?: Id; columnId?: Id;
  selectedItemIds?: Id[]; widgetBoardIds?: Id[] }
export interface SpeciesSummary { dexNumber: number; name: string; types: PokeType[]; spriteUrl: string }
export interface SpeciesDetail extends SpeciesSummary { hp: number; attack: number;
  defense: number; speed: number; flavorText: string }
export interface EvolutionTarget { dexNumber: number; name: string;
  trigger: 'level-up' | 'other'; minLevel: number | null }
export interface EvolutionInfo { stage: 1 | 2 | 3; next: EvolutionTarget[] }
export type Effectiveness = 0 | 0.5 | 1 | 2;
export type TypeChart = Record<PokeType, Partial<Record<PokeType, Effectiveness>>>; // missing = 1
export type PokemonPatch = Partial<Omit<Pokemon, 'id' | 'gym'>>;
export type Unsubscribe = () => void;
export type NoticeType = 'success' | 'error' | 'info';

export interface GameApi {
  listBoards(): Promise<{ id: Id; name: string }[]>;
  getBoardConfig(): Promise<BoardConfig | null>;
  setBoardConfig(cfg: BoardConfig): Promise<void>;
  getContext(): Promise<AppContext>;
  onContextChange(cb: (ctx: AppContext) => void): Unsubscribe;
  onItemChanged(itemId: Id, cb: () => void): Unsubscribe;
  getPokemon(itemId: Id): Promise<Pokemon>;
  getPokemonMany(itemIds: Id[]): Promise<Pokemon[]>;
  listPokemon(opts?: { boardIds?: Id[]; gymId?: Id; status?: Status }): Promise<Pokemon[]>;
  listGyms(opts?: { boardIds?: Id[] }): Promise<Gym[]>;
  getGym(gymId: Id): Promise<Gym>;
  createGym(input: { name: string; type: PokeType }): Promise<Gym>;
  recruit(input: { species: SpeciesDetail; gymId: Id }): Promise<Pokemon>;
  updatePokemon(patches: { id: Id; patch: PokemonPatch }[]): Promise<void>;
  setGym(pokemonIds: Id[], gymId: Id): Promise<void>;
  postUpdate(itemId: Id, body: string): Promise<void>;
  notify(message: string, type: NoticeType): void;
  closeFeature(): void;                       // closes modal/dialog of menu & column features
  listGen1(): Promise<SpeciesSummary[]>;
  getSpecies(dexNumber: number): Promise<SpeciesDetail>;
  getEvolution(dexNumber: number): Promise<EvolutionInfo>;
  getTypeChart(): Promise<TypeChart>;
  talk(prompt: { system: string; user: string }): Promise<string>;
}
```
- `ApiProvider({ api, children })`, `useApi(): GameApi` (throws `'useApi outside ApiProvider'`).

- [ ] **Step 1: Failing test:** `useApi` inside the provider returns the same object; outside it throws `'useApi outside ApiProvider'`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS, `npm run typecheck` is clean.
- [ ] **Step 5: 🧑 Eden checkpoint.** Eden reads `GameApi.ts` and compares it with `docs/verify-early.md` from Step 0.5. Any change is agreed now, before Task 3. Commit: `feat: GameApi contract`.

### Task 3 🤖 Claude: `MockGameApi` + fixtures

**Files:**
- Create: `src/api/mock/fixtures.ts`, `src/api/mock/MockGameApi.ts`
- Test: `src/api/mock/MockGameApi.test.ts`

**Interfaces:**
- Consumes: everything from Task 2.
- Produces: `class MockGameApi implements GameApi`, `constructor(opts?: { context?: Partial<AppContext>; delayMs?: number; failTalk?: boolean })`, plus test helpers `setContext(partial)` and `notices: {message,type}[]`, `updates: {itemId, body}[]`.
- Fixtures: Gen 1 species with real stats from PokéAPI. Must include: Charmander line (4/5/6), Squirtle line (7/8/9), Bulbasaur line (1/2/3), Pikachu 25 (evolves by stone, so no level evolution), Eevee 133 (branching), Zubat 41 → Golbat 42 (stage 2 → Crobat 169 is outside Gen 1), Magnemite 81 (Electric/Steel), Abra 63 (Kadabra → Alakazam by trade). Two gyms: `Cinnabar Gym` (Fire) and `Cerulean Gym` (Water), plus a full roster of 6 in a third gym (Grass) to test Review Focus #2. Full type chart for the 18 types.

- [ ] **Step 1: Failing tests:**
  - `recruit` creates a Pokémon with `level 1, energy 3, status 'Recruited'` linked to the gym, and `getGym` returns it in the roster.
  - `updatePokemon([{id, patch:{level:4}}])` → `getPokemon` returns level 4, and an `onItemChanged(id, cb)` callback is called exactly once.
  - Unsubscribe → the callback isn't called.
  - `setGym` moves the Pokémon between rosters, and `mirroredLevels` updates.
  - `listPokemon({ status: 'Ready' })` filters.
  - `talk` returns a non-empty string; with `failTalk: true` it rejects with `Error('run_prompt failed')`.
  - `notify` and `postUpdate` are recorded in `notices` and `updates`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (an in-memory Map, with string ids `'p1'`, `'g1'`...). **Step 4:** Run → PASS.
- [ ] **Step 5:** `src/main.tsx`: if `import.meta.env.VITE_USE_MOCK === '1'` or `?mock=1` is in the URL → `new MockGameApi()`. Otherwise → `import('./api/monday')` dynamically (fallback: until Eden creates it, the file exports `createMondayGameApi = () => { throw new Error('MondayGameApi not implemented yet') }`. Claude creates this file **with this line only** and doesn't touch it again).
- [ ] **Step 6:** Commit: `feat: in-memory MockGameApi with Gen1 fixtures`.

### Task 4 🧑 Eden: "Verify early" + the `MondayGameApi` skeleton
**Goal:** prove that the iframe → SDK → API path works before any feature depends on it.
- [ ] Read: `monday.get`/`monday.listen` (developer.monday.com/apps/docs/mondayget), SeamlessApiClient (`@mondaycom/api` README), column values for Mirror/Connect (API reference → Column types).
- [ ] Install `monday-sdk-js @mondaydotcomorg/api`. In `src/api/monday/` create `createMondayGameApi(): GameApi` that implements only `getContext` and `onContextChange` for now (everything else: `throw new Error('not yet')`).
- [ ] `npm run dev` + `mapps tunnel:create -p 5173 -a <APP_ID>` → set the Item view URL to `<tunnel>/#/item-view` → open an item in monday.
- [ ] Write in `docs/verify-early.md`, one section per check:
  1. What `context` contains in each feature type (open each of the 7 once with a temporary `console.log`).
  2. Mirror/connect/dropdown/status/link shapes (continuing Step 0.5).
  3. Whether `SeamlessApiClient` with `2026-10` works from the iframe (one `me { id }` query).
  4. **Column resolution without hardcoded IDs:** how you find the `Level` column ID on the board (a `boards { columns { id title type } }` query, then matching by title).
  5. `run_prompt` from the browser: a single call with `MONDAY_FAST`. Record the exact result or error.
- **Done when:** all 5 sections are filled in, and `getContext` returns a valid `AppContext` inside monday.

# Part 2: Game rules (🤖 Claude, pure TDD, no UI)

All files in `src/game/`, tests next to them (`*.test.ts`). `src/game/constants.ts` contains the values from Global Constraints. A helper for tests: `makePokemon(overrides)` in `src/game/testUtils.ts`.

### Task 5 🤖 Claude: Status, Spar, Rest

**Files:** Create `src/game/constants.ts`, `src/game/testUtils.ts`, `src/game/status.ts`. Test `src/game/status.test.ts`.

**Interfaces (Produces):**
```ts
type SparError = 'NEED_TWO' | 'DUPLICATE' | 'NO_GYM' | 'DIFFERENT_GYMS' | 'NO_ENERGY' | 'RESTING';
deriveStatus(p: Pick<Pokemon,'level'|'energy'>): Status            // energy 0→Resting; level≥5→Ready; else Training
validateSpar(ps: Pokemon[]): { ok: true } | { ok: false; error: SparError; names?: string[] }
applySpar(p: Pokemon): PokemonPatch                                 // { level+1, energy-1, status: deriveStatus(after) }
applyRest(p: Pokemon): PokemonPatch                                 // { energy: 3, status: level≥5 ? Ready : Training }
allowedTransitions(p: Pokemon): { to: Status[]; canRest: boolean }
```
- [ ] **Step 1: Failing tests (exact values):**
  - `applySpar(lvl 1, energy 3)` → `{level:2, energy:2, status:'Training'}`; `applySpar(lvl 4, energy 2)` → `{level:5, energy:1, status:'Ready'}`; `applySpar(lvl 4, energy 1)` → `{level:5, energy:0, status:'Resting'}`.
  - `validateSpar([a])` → `NEED_TWO`; `[a,a]` → `DUPLICATE`; different gyms → `DIFFERENT_GYMS`; one with `gym:null` → `NO_GYM`; energy 0 → `NO_ENERGY` with `names`; `status:'Resting'` → `RESTING`; a valid pair → `{ok:true}`.
  - `applyRest(lvl 3)` → `{energy:3, status:'Training'}`; `applyRest(lvl 5)` → `{energy:3, status:'Ready'}`.
  - `allowedTransitions`: Recruited → `['Training']`; Training lvl 4 → `['Resting']`; Training lvl 5 → `['Ready','Resting']`; Ready → `['Training','Resting']`; Resting → `{to:[], canRest:true}`; anything not Resting → `canRest:false`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit `feat(game): status, spar, rest rules`.

### Task 6 🤖 Claude: Roster and Transfer

**Files:** `src/game/roster.ts`, test `src/game/roster.test.ts`.

**Interfaces (Produces):**
```ts
type JoinError = 'TYPE_MISMATCH' | 'ROSTER_FULL' | 'GYM_HAS_NO_TYPE';
canJoinGym(p: Pick<Pokemon,'types'>, gym: Gym): { ok: true } | { ok: false; error: JoinError }
validateTransfer(ps: Pokemon[], target: Gym):
  { ok: true; moving: Pokemon[]; alreadyThere: Pokemon[] }
  | { ok: false; error: JoinError | 'DUPLICATE'; names: string[] }
```
- [ ] **Step 1: Failing tests:** Fire into a Fire gym → ok. Grass/Poison into a Poison gym → ok (any type matches). Water into Fire → `TYPE_MISMATCH`. A full gym (6) → `ROSTER_FULL`. A gym with 5 + 2 incoming → `ROSTER_FULL`, and **no** partial move (Review Focus #2). A Pokémon already in the target → goes to `alreadyThere` and doesn't count toward the limit. One invalid in a batch → the whole batch fails, with `names` listing the failing ones.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat(game): roster and transfer validation`.

### Task 7 🤖 Claude: Evolution

**Files:** `src/game/evolution.ts`, test `src/game/evolution.test.ts`.

**Interfaces (Produces):**
```ts
type EvoBlock = 'MAX_STAGE' | 'NO_LEVEL_EVOLUTION' | 'BRANCHING' | 'OUTSIDE_GEN1' | 'LEVEL_TOO_LOW';
evolutionCheck(p: Pokemon, evo: EvolutionInfo):
  { eligible: true; target: EvolutionTarget } | { eligible: false; reason: EvoBlock; atLevel?: number }
applyEvolution(species: SpeciesDetail): PokemonPatch   // name, dexNumber, types, spriteUrl, hp, attack, defense, speed only
evolutionMessage(from: string, to: string): string     // `${from} evolved into ${to}`
```
- [ ] **Step 1: Failing tests:** Charmander stage 1, lvl 3 → eligible → Charmeleon. Lvl 2 → `LEVEL_TOO_LOW, atLevel 3`. Charmeleon stage 2, lvl 5 → `LEVEL_TOO_LOW, atLevel 6`; lvl 6 → Charizard. Charizard → `MAX_STAGE`. Pikachu (trigger `other`) → `NO_LEVEL_EVOLUTION`. Eevee (several `next`) → `BRANCHING`. Golbat → Crobat 169 → `OUTSIDE_GEN1`. `applyEvolution` contains no `level`/`energy`/`status` keys. `evolutionMessage('Charmeleon','Charizard') === 'Charmeleon evolved into Charizard'`.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat(game): level-based evolution`.

### Task 8 🤖 Claude: Battle

**Files:** `src/game/rng.ts`, `src/game/battle.ts`, test `src/game/battle.test.ts`.

**Interfaces (Produces):**
```ts
type Rng = () => number;                                   // [0,1)
mulberry32(seed: number): Rng
effectiveness(attacker: PokeType[], defender: PokeType[], chart: TypeChart): Effectiveness // max over attacker types vs defender[0]
roundScore(a: Pokemon, d: Pokemon, chart: TypeChart, r: number): number
  // (a.attack + a.speed + a.hp) * (1 + a.level/10) * effectiveness * (LUCK_MIN + (LUCK_MAX-LUCK_MIN)*r)
eligibleFighters(g: Gym): Pokemon[]                        // status Ready && energy ≥ 1, roster order, max 6
interface Round { index: number; a: Pokemon; b: Pokemon; scoreA: number; scoreB: number; winner: 'A'|'B'|'draw' }
type BattleResult =
  | { ok: false; error: 'A_NOT_ELIGIBLE' | 'B_NOT_ELIGIBLE' | 'SAME_GYM' }
  | { ok: true; rounds: Round[]; winsA: number; winsB: number; totalA: number; totalB: number;
      winner: 'A' | 'B' | 'draw'; decidedBy: 'rounds' | 'total' | 'draw' }
battle(gymA: Gym, gymB: Gym, chart: TypeChart, rng: Rng): BattleResult  // rng called A then B, per round
battleSummary(gymA: Gym, gymB: Gym, r: BattleResult & { ok: true }): string   // plain text for the update
```
- [ ] **Step 1: Failing tests (exact values, `r = 0.5` → luck 1.0):**
  - Charmander lvl 5 (39/52/65) vs Bulbasaur lvl 5 (45/49/45) with `Fire→Grass 2`, `Grass→Fire 0.5`: `roundScore` = **468** and **104.25**.
  - `effectiveness(['Electric'], ['Ground','Flying'])` with `Electric→Ground 0` → 0 (primary type only). `effectiveness(['Grass','Poison'], ['Water'])` → 2 (the attacker's best type).
  - 3 Ready against 2 Ready → 2 rounds. 1–1 in wins → `decidedBy:'total'`. A gym with only Resting → `A_NOT_ELIGIBLE`. Same gym twice → `SAME_GYM`.
  - `mulberry32(42)` gives the same sequence twice → `battle` is deterministic.
  - `battleSummary` contains both gym names, the winner and the round count.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat(game): battle engine`.

### Task 9 🤖 Claude: Widget aggregates + Talk prompt

**Files:** `src/game/stats.ts`, `src/game/talk.ts`, tests next to them.

**Interfaces (Produces):**
```ts
interface GymStatRow { gymId: Id; name: string; count: number; avgLevel: number | null }
gymStats(input: { gyms?: Gym[]; pokemon?: Pokemon[] }):
  { perGym: GymStatRow[]; perStatus: Record<Status, number> | null }
buildTalkPrompt(s: SpeciesDetail): { system: string; user: string }
```
- [ ] **Step 1: Failing tests:**
  - `gymStats({gyms})` only → `perStatus: null`, `avgLevel` from `mirroredLevels` (`[1,4]` → 2.5; empty → `null`).
  - `gymStats({pokemon})` only → grouped by `gym.id`; a Pokémon without a gym → a row `gymId:'none', name:'No gym'`. `perStatus` counts all 4 statuses (including 0).
  - Both supplied → `perGym` from gyms, `perStatus` from pokemon.
  - `buildTalkPrompt(pikachu)`: `system` contains `Pikachu`, `Electric` and the flavor text, plus an instruction to answer in 1–2 short lines, mostly its catchphrase/signature sound, in character. `user` is not empty. Evolved Raichu → `system` contains `Raichu` and not `Pikachu`.
- [ ] **Steps 2–5:** FAIL → implement → PASS → commit `feat(game): stats aggregation and talk prompt`.

# Part 3: Shared UI (🤖 Claude)

### Task 10 🤖 Claude: Shared components, hooks, theme and BoardSetup

**Files:**
- Create: `src/lib/useAsync.ts`, `src/lib/useAppContext.ts`, `src/lib/messages.ts`, `src/components/{TypeBadge,StatusBadge,StatBar,PokemonCard,States}.tsx`, `src/features/setup/BoardSetup.tsx`, `src/features/setup/RequireBoardConfig.tsx`
- Test: `src/lib/useAsync.test.ts`, `src/features/setup/BoardSetup.test.tsx`

**Interfaces (Produces):**
- `useAsync<T>(fn: () => Promise<T>, deps): { data?: T; error?: Error; loading: boolean; reload(): void }`
- `useAppContext(): AppContext | undefined`: subscribes to `onContextChange` and sets `document.documentElement.classList.toggle('dark', theme !== 'light')`.
- `messages.ts`: `sparErrorText(e: SparError, names?)`, `joinErrorText(...)`, `evoBlockText(...)`, `battleErrorText(...)`. **All UI copy lives here.**
- `<Loading/>`, `<ErrorState error onRetry/>`, `<Empty title hint/>`, `<TypeBadge type/>`, `<StatusBadge status/>`, `<StatBar label value max=255/>`, `<PokemonCard pokemon compact?/>`.
- `<RequireBoardConfig>{(cfg) => ...}</RequireBoardConfig>`: if `getBoardConfig()` is `null`, it shows `BoardSetup`. After Save it calls `setBoardConfig` and renders the children.

- [ ] **Step 1: Failing tests:** `useAsync`: loading → data; reject → error; `reload` calls again. BoardSetup: with a null config → two selects from `listBoards()`; Save is disabled until both are chosen and differ; Save → `setBoardConfig` is called with `{gymsBoardId, pokemonBoardId}` and the children render.
- [ ] **Steps 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Wire the real screens into `main.tsx` as they are built. For now, placeholders. Run `npm run dev` with `?mock=1#/setup` → check in the browser pane that BoardSetup works.
- [ ] **Step 6:** Commit `feat(ui): shared components, hooks, board setup`.

# Part 4: Features, one at a time (each: 🤖 Claude on the mock → 🧑 Eden connects → check in monday)

The fixed pattern: **(a)** Claude builds the screen with RTL tests against `MockGameApi` and shows it in the browser pane with `?mock=1`. **(b)** Eden implements the methods listed in the matching Eden task, sets the feature URL to `<tunnel>/#/<route>`, and checks the acceptance criteria inside monday. **(c)** Eden writes 2–3 lines in `docs/concepts.md`: which monday concept was used and why (needed for "Done when" in the spec).

### Task 11 🤖 Claude: Item view: Pokémon profile + Talk (6.1 + 6.7)

**Files:** `src/features/item-view/{ItemView,TalkPanel}.tsx`, test `ItemView.test.tsx`

**Interfaces:** Consumes `getContext().itemId`, `getPokemon`, `onItemChanged`, `getSpecies`, `talk`, `buildTalkPrompt`.

- [ ] **Step 1: Failing tests:**
  - With mock context `itemId:'p1'` → shows the name, sprite (`img[alt=name]`), type badges, 4 StatBars, level, energy, status and gym name.
  - `api.updatePokemon` on that item → the new level appears with no user action (Review Focus #5).
  - No `itemId` in the context → `Empty` "Open this view inside a Pokémon item".
  - Talk → `talk` is called with the output of `buildTalkPrompt(getSpecies(dex))` → the reply appears in a bubble. With `failTalk` → a friendly fallback ("… is napping right now. Try again later.") and **not** the technical error.
  - After evolution (patch name Charmeleon / dex 5) → the next Talk builds the prompt from dex 5.
- [ ] **Steps 2–4:** FAIL → implement → PASS. **Step 5:** Visual check in the browser pane. **Step 6:** Commit.

### Task 12 🧑 Eden: Connect the Item view
- [ ] Implement: `getPokemon` (one query, only the needed columns via `column_values(ids: [...])`), `onItemChanged` (with `monday.listen` (`events`), filtered by itemId), `getSpecies` (PokéAPI `pokemon/{n}` + `pokemon-species/{n}` → the English flavor text, **with a cache**), `talk` (`run_prompt` with `MONDAY_FAST`, max_tokens ~60, temperature 0.8).
- [ ] Column resolution by title, stored in memory or storage once per board (from Task 4, section 4).
- [ ] Acceptance: open 2 different items, both show a profile. Change Level in the board, and the profile updates. Talk works, or the failure is documented in `docs/verify-early.md` §5.

### Task 13 🤖 Claude: Board view: gym roster (6.2)

**Files:** `src/features/board-view/BoardView.tsx`, test next to it.

**Interfaces:** Consumes `getContext().boardId`, `listGyms({boardIds:[boardId]})`, `PokemonCard`, `STATUSES`.

- [ ] **Step 1: Failing tests:** a gym Select (default: the first one), a card grid for its roster (sprite, name, level, status). Status chips with **All** + 4 statuses; choosing `Ready` hides the rest; an empty filter → Empty. The context `boardId` is passed to `listGyms`. A gym with an empty roster → Empty "No Pokémon in this gym yet".
- [ ] **Steps 2–6:** FAIL → implement → PASS → browser pane → commit.

### Task 14 🧑 Eden: Connect the Board view
- [ ] Implement `listGyms` / `getGym`: Gyms items + `BoardRelationValue.linked_item_ids` + the mirror. The roster comes from **one** `items(ids: [...])` query for all linked ids, not one query per Pokémon (performance). Also the BoardConfig methods (storage + `boards` query).
- [ ] Acceptance (6.2): cards, filter and context. Also note in `docs/concepts.md` why the mirror alone isn't enough for the cards.

### Task 15 🤖 Claude: Dashboard widget (6.3)

**Files:** `src/features/widget/Widget.tsx`, test.

**Interfaces:** Consumes `getContext().widgetBoardIds`, `getBoardConfig`, `listGyms`, `listPokemon`, `gymStats`.

- [ ] **Step 1: Failing tests:** both boards connected → a per-gym table (count, average level to 1 decimal place) + per-status counts. Gyms board only → the table + a "Connect the Pokémon board to see status" hint. Pokémon board only → full data. No board → Empty "Connect the Gyms and/or Pokémon board in widget settings". Telling the boards apart: match against `getBoardConfig()`. If there is no config → BoardSetup.
- [ ] **Steps 2–6:** FAIL → implement → PASS → browser pane → commit.

### Task 16 🧑 Eden: Connect the Widget
- [ ] Implement `listPokemon` (with `items_page` + `query_params` for gym/status filtering on the server, not in the client) and the mapping of `widgetBoardIds` from the context.
- [ ] Acceptance (6.3) with one board and with two.

### Task 17 🤖 Claude: Board menu: Spar + Transfer (6.4)

**Files:** `src/features/board-menu/{SparAction,TransferAction}.tsx`, tests.

**Interfaces:** Consumes `selectedItemIds`, `getPokemonMany`, `validateSpar`, `applySpar`, `validateTransfer`, `listGyms`, `updatePokemon`, `setGym`, `notify`, `closeFeature`, `messages.ts`.

- [ ] **Step 1: Failing tests:**
  - Spar, valid pair → shows "before → after" for both → Confirm → **one** `updatePokemon` with 2 patches → `notify(success)` → `closeFeature`.
  - Spar invalid (each `SparError`) → `notify(error)` with the text from `messages.ts`, `updatePokemon` **not** called, and Confirm is not shown.
  - Transfer: a list of gyms (excluding the shared current gym). An invalid gym shows as disabled with its reason. Choose → `setGym` with only `moving` → success. If every selected Pokémon is `alreadyThere` → info "Nothing to move".
  - Transfer with a batch that overflows → error, `setGym` not called (Review Focus #2).
- [ ] **Steps 2–6:** FAIL → implement → PASS → browser pane (`?mock=1#/spar` with mock context `selectedItemIds`) → commit.

### Task 18 🧑 Eden: Connect the Board menu
- [ ] Implement `getPokemonMany`, `updatePokemon` (**`change_multiple_column_values`**, several mutations in one request with GraphQL aliases), `setGym` (the connect column on the Pokémon board), `notify` (`monday.execute('notice', …)`), `closeFeature` (find the right command in the `monday.execute` docs).
- [ ] Acceptance (6.4): every case in the spec, including "invalid → changes nothing".

### Task 19 🤖 Claude: Column view: Status dialog + Evolve (6.5, "the main feature")

**Files:** `src/features/column-view/StatusDialog.tsx`, test.

**Interfaces:** Consumes `getContext().itemId`, `getPokemon`, `allowedTransitions`, `applyRest`, `getEvolution`, `evolutionCheck`, `getSpecies`, `applyEvolution`, `evolutionMessage`, `updatePokemon`, `postUpdate`, `closeFeature`.

- [ ] **Step 1: Failing tests:**
  - Each status shows exactly the buttons from `allowedTransitions` (the 5 cases from Task 5). Click → `updatePokemon({status})` → `closeFeature`.
  - Resting → a single Rest button → patch `{energy:3, status: Training/Ready}` according to level.
  - Charmander lvl 3 → an Evolve button with a preview "→ Charmeleon" + sprite. Lvl 2 → **no** Evolve button, and a small "Evolves at level 3" hint. Pikachu/Eevee/Golbat → no button (Review Focus #3).
  - Evolve → `updatePokemon` with `applyEvolution(getSpecies(5))` → `postUpdate(itemId, 'Charmander evolved into Charmeleon')` → the screen updates to show Charmeleon. Level, gym and status are unchanged.
  - Write failure → ErrorState, `postUpdate` not called.
- [ ] **Steps 2–6:** FAIL → implement → PASS → browser pane → commit.

### Task 20 🧑 Eden: Connect the Column view
- [ ] Implement `getEvolution` (`pokemon-species/{n}` → `evolution_chain.url` → find the current stage and the `next` list with trigger/min_level, **with a cache per chain**), `postUpdate` (`create_update`).
- [ ] Set up the Status column feature with an *On Click Dialog* that points to `#/column-view`, then attach it to the Status column on the Pokémon board.
- [ ] Acceptance (6.5): all 6 criteria in the spec. This is the main feature, so test it on at least 3 Pokémon at different stages.

### Task 21 🤖 Claude: Custom object: Gym HQ (6.6)

Split into 3 sub-tasks with a commit after each. Everything is wrapped in `RequireBoardConfig`.

**Files:** `src/features/gym-hq/{GymHQ,GymsTab,RecruitTab,ArenaTab}.tsx`, tests for each tab.

- [ ] **21a GymsTab, failing tests:** a create form (name + type Select from the 18) → `createGym` → the gym appears in the list. Empty name → Save disabled. Each gym expands to its roster (PokemonCard compact) with a count of `n/6`.
- [ ] **21b RecruitTab, failing tests:** `listGen1` → a grid of 151 (sprite + name + types). Searching by name ("char" → 3 results). A type filter (Fire → only Fire). Choosing a Pokémon + gym → `canJoinGym` → invalid shows a message from `messages.ts` and `recruit` is not called. Valid → `getSpecies` → `recruit({species, gymId})` → success notify → the roster updates.
- [ ] **21c ArenaTab, failing tests:** two gym Selects (the same gym can't be picked twice). Battle → `battle(a, b, getTypeChart(), mulberry32(Date.now()))` → a table with columns `# | A | score | B | score | winner`, the winning row highlighted, and a headline for the battle winner. Not eligible → an error message, no table, `postUpdate` not called (Review Focus #4). Valid → `postUpdate` **on both gyms** with `battleSummary`.
- [ ] **For each sub-task:** FAIL → implement → PASS → browser pane → commit.

### Task 22 🧑 Eden: Connect Gym HQ
- [ ] Implement `createGym` (`create_item` with the dropdown), `recruit` (`create_item` with all the columns + a connect value to the gym in **one** mutation), `listGen1` (`pokemon?limit=151` + types: think about how to avoid 151 requests every time. **Cache in SDK storage**), `getTypeChart` (18 `type/{name}` requests → `damage_relations` → cache).
- [ ] Acceptance (6.6): all the criteria in the spec, including that PokéAPI isn't fetched again on a second visit (check the Network tab).
- **Change (2026-11-19):** the custom object can't be added until the app is installed (admins only in our account, `verify-early.md` §10). Decision: Gym HQ is a board view, "Gym HQ View", on the same `#/gym-hq` route, for good. The Object feature was deleted from the Developer Center.

# Part 5: Deploy and finish

### Task 23 🧑 Eden (+ 🤖 Claude for the build check): Deploy to monday code
- [ ] 🤖 Claude: `npm run typecheck && npx vitest run && npm run build`, all clean. `dist/index.html` exists at the root of `dist`.
- [ ] 🧑 Eden: `mapps code:push -c -d ./dist -a <APP_ID>`. In each feature, change the URL from the tunnel to monday code hosting (keeping the same `#/route`).
- [ ] 🧑 Eden: go through the acceptance criteria for 6.1–6.7 again, this time without the tunnel (`npm run dev` stopped).
- [ ] 🧑 Eden: complete `docs/concepts.md` for each of the 7 features: which monday concept and why.
- **Done when:** every item in section 9 of the spec ("Done when") is checked.

---

## Execution order and parallel work
```
Part 0 (Eden) ─► T1 ─► T2 ─(Eden review)─► T3 ─┬─► T5..T9 (rules) ─► T10 ─► T11 ─► T13 ─► T15 ─► T17 ─► T19 ─► T21
                                               └─► T4 (Eden verify-early)      T12     T14     T16     T18     T20     T22 ─► T23
```
Claude's track continues on the mock without waiting for Eden. Eden connects each screen once it's ready. Synchronization points: **T2** (agreeing the contract) and **T23** (deploy).
